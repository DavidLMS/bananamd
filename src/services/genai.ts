import { GoogleGenAI, type GenerateContentResponse, type Part, Modality } from "@google/genai";

export type GenAIRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];

export const fileToGenerativePart = async (file: File): Promise<Part> => {
    const base64EncodedData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: {
            data: base64EncodedData,
            mimeType: file.type,
        },
    };
};

export const generateContentWithRetry = async (
    ai: GoogleGenAI,
    request: GenAIRequest,
    retries = 5,
    initialDelay = 1000
): Promise<GenerateContentResponse> => {
    let lastError: any = null;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await ai.models.generateContent(request);
            return response;
        } catch (error) {
            lastError = error;
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            
            if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
                console.warn(`Gemini API call attempt ${i + 1} of ${retries} failed with rate limit error. Retrying...`);
                if (i < retries - 1) {
                    const jitter = Math.random() * 500;
                    const delay = initialDelay * Math.pow(2, i) + jitter;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } else {
                console.error(`Gemini API call failed with non-retryable error:`, error);
                throw error;
            }
        }
    }
    console.error('All retry attempts failed.');
    throw lastError || new Error('Failed to generate content after all retries.');
};

export const generateImageFromPrompt = async (ai: GoogleGenAI, prompt: string, styleImagePart?: Part): Promise<string> => {
    // Always request image modality and provide a structured content payload
    const styledPrompt = styleImagePart
        ? `${prompt}\n\nTransform the described scene into the artistic style of the attached reference image. Preserve the described composition, but render all elements with the reference image's stylistic characteristics (palette, brushwork, line quality, textures).`
        : prompt;
    const parts: Part[] = styleImagePart ? [{ text: styledPrompt }, styleImagePart] : [{ text: styledPrompt }];
    const request: GenAIRequest = {
        model: "gemini-2.5-flash-image-preview",
        contents: { parts },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    };

    const response = await generateContentWithRetry(ai, request);
    const img = extractImageFromCandidates((response as any).candidates || []);
    if (img) return img;
    throw new Error("API did not return an image. It may have refused the prompt.");
};

export const generateImageVariation = async (ai: GoogleGenAI, base64ImageWithMime: string, altText: string, styleImagePart?: Part): Promise<string> => {
    const mimeType = base64ImageWithMime.substring(base64ImageWithMime.indexOf(":") + 1, base64ImageWithMime.indexOf(";"));
    const data = base64ImageWithMime.split(',')[1];

    const imagePart: Part = {
        inlineData: {
            mimeType,
            data,
        },
    };
    
    let textPrompt: string;
    if (styleImagePart) {
        textPrompt = `You will receive two images: the first is the BASE content to restyle, the second is a STYLE REFERENCE only.\n\nTask: Redraw the BASE image entirely in the artistic style of the STYLE REFERENCE. Preserve the BASE scene layout and core subjects (positions and proportions), but restyle ALL forms, edges and surfaces to match the reference's technique: palette, brush/line quality, material texture and lighting mood. Do NOT copy, merge or insert any objects, backgrounds or layout from the STYLE REFERENCE; use it only as a style guide. Output must look fully repainted in that style while keeping the same composition and subject identity.${altText ? `\nContext about subject: "${altText}".` : ''}`;
    } else {
        textPrompt = `Improve this image: enhance clarity, lighting, dynamic range, and detail; preserve composition and subject.${altText ? ` Context: "${altText}".` : ''}`;
    }

    // dev logging removed
    const response = await generateContentWithRetry(ai, {
        model: 'gemini-2.5-flash-image-preview',
        contents: {
            // Put instruction first, then base, then style for clarity
            parts: styleImagePart ? [{ text: textPrompt }, imagePart, styleImagePart] : [{ text: textPrompt }, imagePart],
        },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });

    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            const imageData = part.inlineData.data;
            const responseMimeType = part.inlineData.mimeType || 'image/png';
            return `data:${responseMimeType};base64,${imageData}`;
        }
    }
    throw new Error("API did not return an image variation.");
};

// --- Iterative Editing (Chat) Helpers ---

// Simple in-memory chat session store keyed by a branch/node id.
const chatSessions: Map<string, { chat: any; seededWithImageId?: string }> = new Map();

const dataUrlToPart = (base64ImageWithMime: string): Part => {
    const mimeType = base64ImageWithMime.substring(base64ImageWithMime.indexOf(":") + 1, base64ImageWithMime.indexOf(";"));
    const data = base64ImageWithMime.split(',')[1];
    return {
        inlineData: {
            mimeType,
            data,
        },
    };
};

const extractImageFromCandidates = (candidates: any[]): string | null => {
    for (const cand of candidates || []) {
        const parts: Part[] = cand?.content?.parts || [];
        for (const part of parts) {
            if ((part as any).inlineData) {
                const imageData = (part as any).inlineData.data;
                const mimeType = (part as any).inlineData.mimeType || 'image/png';
                return `data:${mimeType};base64,${imageData}`;
            }
        }
    }
    return null;
};

/**
 * Ensures a chat session for a given branch key. If chat is available in the SDK, uses it; otherwise
 * falls back to unary generateContent calls for each edit.
 */
export const ensureChatForBranch = async (
    ai: GoogleGenAI,
    branchKey: string,
    baseImageDataUrl: string
): Promise<{ mode: 'chat' | 'unary'; chat?: any; baseImagePart: Part }> => {
    const baseImagePart = dataUrlToPart(baseImageDataUrl);
    const hasChat = typeof (ai as any)?.chats?.create === 'function';
    if (!hasChat) {
        return { mode: 'unary', baseImagePart };
    }

    const existing = chatSessions.get(branchKey);
    if (existing) {
        return { mode: 'chat', chat: existing.chat, baseImagePart };
    }

    // Create a new chat seeded with the base image on first message.
    const chat = (ai as any).chats.create({ model: 'gemini-2.5-flash-image-preview' });
    chatSessions.set(branchKey, { chat });
    return { mode: 'chat', chat, baseImagePart };
};

/**
 * Sends an edit instruction using chat mode if available; otherwise uses unary generateContent.
 * Returns base64 data URL of the new image.
 */
export const generateEditedImage = async (
    ai: GoogleGenAI,
    branchKey: string,
    currentImageDataUrl: string,
    instruction: string,
    styleImagePart?: Part
): Promise<string> => {
    const { mode, chat, baseImagePart } = await ensureChatForBranch(ai, branchKey, currentImageDataUrl);

    // Ensure the very first edit is ALWAYS anchored to the current image.
    // Some SDK chat paths may ignore binary parts on the first sendMessage.
    const state = chatSessions.get(branchKey);
    const isFirstTurn = !state?.seededWithImageId;
    if (isFirstTurn) {
        // dev logging removed
        const response = await generateContentWithRetry(ai, {
            model: 'gemini-2.5-flash-image-preview',
            contents: {
                // Instruction first for clarity, then base, then style
                parts: styleImagePart
                    ? [
                        { text: `${instruction}\n\nRedraw the current image from scratch in the artistic style of the attached reference image. Preserve the existing scene layout and core subjects, but restyle ALL forms, edges and surfaces to match the reference's technique (palette, brush/line quality, texture, lighting). Do NOT copy or insert any objects or layout from the reference.` },
                        dataUrlToPart(currentImageDataUrl),
                        styleImagePart
                      ]
                    : [
                        { text: instruction },
                        dataUrlToPart(currentImageDataUrl)
                      ],
            },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });
        const firstImg = extractImageFromCandidates((response as any).candidates || []);
        if (firstImg) {
            // Mark this branch as seeded so subsequent turns can use chat (or continue unary).
            const existing = chatSessions.get(branchKey) || { chat } as any;
            existing.seededWithImageId = branchKey;
            chatSessions.set(branchKey, existing);
            return firstImg;
        }
        // If for any reason the unary path fails to return an image, fall through to other paths.
    }

    if (mode === 'chat' && chat) {
        // dev logging removed
        const response = await chat
            .sendMessage({
                message: instruction,
                // Instruction first for clarity
                parts: styleImagePart
                    ? [
                        { text: `${instruction}\n\nRedraw the current image from scratch in the artistic style of the attached reference image. Preserve the existing scene layout and core subjects, but restyle ALL forms, edges and surfaces to match the reference's technique (palette, brush/line quality, texture, lighting). Do NOT copy or insert any objects or layout from the reference.` },
                        baseImagePart,
                        styleImagePart
                      ]
                    : [
                        { text: instruction },
                        baseImagePart
                      ]
            })
            .catch(() => null as any);
        if (response?.candidates) {
            const img = extractImageFromCandidates(response.candidates as any[]);
            if (img) return img;
        }
        // If chat path failed to return an image, fall back to unary below.
    }

    // Unary fallback: send current image + instruction in a single turn.
    const response = await generateContentWithRetry(ai, {
        model: 'gemini-2.5-flash-image-preview',
        contents: {
            parts: styleImagePart
                ? [
                    dataUrlToPart(currentImageDataUrl),
                    styleImagePart,
                    { text: `${instruction}\n\nRedraw the current image from scratch in the artistic style of the attached reference image. Preserve the existing scene layout and core subjects, but restyle ALL forms, edges and surfaces to match the reference's technique (palette, brush/line quality, texture, lighting). Do NOT copy or insert any objects or layout from the reference.` }
                  ]
                : [dataUrlToPart(currentImageDataUrl), { text: instruction }],
        },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    const img = extractImageFromCandidates((response as any).candidates || []);
    if (!img) throw new Error('Edit did not return an image.');
    return img;
};

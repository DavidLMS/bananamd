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
    const parts: Part[] = styleImagePart ? [{ text: prompt }, styleImagePart] : [{ text: prompt }];
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

export const generateImageVariation = async (ai: GoogleGenAI, base64ImageWithMime: string, altText: string): Promise<string> => {
    const mimeType = base64ImageWithMime.substring(base64ImageWithMime.indexOf(":") + 1, base64ImageWithMime.indexOf(";"));
    const data = base64ImageWithMime.split(',')[1];

    const imagePart: Part = {
        inlineData: {
            mimeType,
            data,
        },
    };
    
    const textPrompt = altText 
        ? `Generate a new version of this image, inspired by the following description: "${altText}". Maintain the core subject but render it in a new artistic style.`
        : `Generate a new, creative, artistic variation of this image.`;

    const response = await generateContentWithRetry(ai, {
        model: 'gemini-2.5-flash-image-preview',
        contents: {
            parts: [imagePart, { text: textPrompt }],
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
    instruction: string
): Promise<string> => {
    const { mode, chat, baseImagePart } = await ensureChatForBranch(ai, branchKey, currentImageDataUrl);

    if (mode === 'chat' && chat) {
        // For the first turn on a branch, include the image; subsequent turns can be text-only.
        const state = chatSessions.get(branchKey);
        const isFirstTurn = !state?.seededWithImageId;

        const response = isFirstTurn
            ? await chat.sendMessage({
                // Many SDKs accept a rich message object; if not, the fallback below handles it.
                message: instruction,
                // Some SDKs allow parts: if available, try to include the image part.
                parts: [baseImagePart, { text: instruction }]
              }).catch(async () => {
                // Fallback: if parts are not supported, try plain message first, then unary.
                return null as any;
              })
            : await chat.sendMessage({ message: instruction }).catch(() => null as any);

        if (response?.candidates) {
            const img = extractImageFromCandidates(response.candidates as any[]);
            if (img) {
                if (isFirstTurn && state) {
                    state.seededWithImageId = branchKey;
                    chatSessions.set(branchKey, state);
                }
                return img;
            }
        }
        // If chat path failed to return an image, fall back to unary below.
    }

    // Unary fallback: send current image + instruction in a single turn.
    const response = await generateContentWithRetry(ai, {
        model: 'gemini-2.5-flash-image-preview',
        contents: {
            parts: [dataUrlToPart(currentImageDataUrl), { text: instruction }],
        },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    const img = extractImageFromCandidates((response as any).candidates || []);
    if (!img) throw new Error('Edit did not return an image.');
    return img;
};

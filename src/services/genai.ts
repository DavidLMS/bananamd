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
    let contents: GenAIRequest['contents'];
    let config: GenAIRequest['config'];

    if (styleImagePart) {
        contents = {
            parts: [{ text: prompt }, styleImagePart]
        };
        config = {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        };
    } else {
        contents = prompt;
    }

    const request: GenAIRequest = {
        model: "gemini-2.5-flash-image-preview",
        contents,
    };
    if (config) {
        request.config = config;
    }

    const response = await generateContentWithRetry(ai, request);

    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            const imageData = part.inlineData.data;
            const mimeType = part.inlineData.mimeType || 'image/png';
            return `data:${mimeType};base64,${imageData}`;
        }
    }
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
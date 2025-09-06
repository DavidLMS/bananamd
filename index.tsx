import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { GoogleGenAI, type GenerateContentResponse, type Part, Modality } from "@google/genai";

const UploadIcon = () => (
    <svg className="drop-zone-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
);

const CheckIcon = () => (
    <svg className="tick" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
);

const ChevronIcon = ({ expanded }) => (
    <svg className={`chevron-icon ${expanded ? 'expanded' : ''}`} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
);

const Spinner = () => (
    <div className="spinner-container">
        <div className="spinner"></div>
    </div>
);

const InlineSpinner = () => <div className="inline-spinner"></div>;

const Modal = ({ isOpen, onClose, content }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Markdown Context</h3>
                    <button className="modal-close-button" onClick={onClose} aria-label="Close modal">&times;</button>
                </div>
                <div className="modal-body">
                    <pre><code>{content}</code></pre>
                </div>
            </div>
        </div>
    );
};

const DropZone = ({ id, onFileSelect, acceptedTypes, file, label, dragLabel, error }) => {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            onFileSelect(files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            onFileSelect(files[0]);
        }
    };

    const handleClick = () => {
        inputRef.current?.click();
    }

    return (
        <div
            className={`drop-zone ${isDragging ? 'drag-over' : ''} ${error ? 'has-error' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={handleClick}
            aria-label={label}
        >
            <input
                ref={inputRef}
                type="file"
                id={id}
                accept={acceptedTypes}
                onChange={handleChange}
            />
            {file ? (
                <p className="file-name">{file.name}</p>
            ) : (
                <>
                    <UploadIcon />
                    <p className="drop-zone-text">{dragLabel} or <span>browse</span></p>
                    <p className="drop-zone-text" style={{fontSize: '0.8rem', marginTop: '0.5rem'}}>{label}</p>
                </>
            )}
            {error && <p className="error-text">{error}</p>}
        </div>
    );
};

interface ImageReference {
    lineNumber: number;
    alt: string;
    path: string;
    context: string;
    status: 'existing' | 'to-generate';
    isGeneratingPrompts?: boolean;
    proposedPrompts?: [string, string];
    isGeneratingImages?: boolean;
    generatedImages?: [string | null, string | null];
    generationError?: string;
    originalImage?: string;
    isGeneratingVariation?: boolean;
    generatedVariation?: string | null;
    variationError?: string;
}

const ImageReferenceItem = ({ reference, onOpenContext, onGenerateVariation }: { reference: ImageReference, onOpenContext: (context: string) => void, onGenerateVariation: (ref: ImageReference) => void }) => {
    const { 
        path, alt, lineNumber, status, context,
        isGeneratingPrompts, proposedPrompts,
        isGeneratingImages, generatedImages, generationError,
        originalImage, isGeneratingVariation, generatedVariation, variationError
    } = reference;
    
    return (
        <div className={`image-reference-item status-${status}`} aria-live="polite">
            <div className="item-header">
                <span className="item-path" title={path}>{path}</span>
                <span className="item-line">L{lineNumber}</span>
            </div>
            {alt && <p className="item-alt">Alt: "{alt}"</p>}
            
            <div className="item-body">
                {status === 'existing' && (
                    <div className="existing-image-container">
                        <div className="image-column">
                            <h4 className="column-label">Original</h4>
                            {originalImage ? (
                                <div className="generated-image-wrapper">
                                    <img src={originalImage} alt="Original image" className="generated-image" />
                                </div>
                            ) : (
                                <div className="generated-image-wrapper placeholder">
                                    Cannot load image.
                                </div>
                            )}
                        </div>
                        <div className="image-column">
                             <h4 className="column-label">AI Variation</h4>
                             {isGeneratingVariation ? (
                                 <div className="generated-image-wrapper skeleton" aria-busy="true" aria-label="Loading variation"></div>
                             ) : generatedVariation ? (
                                 <div className="generated-image-wrapper">
                                    <img src={generatedVariation} alt="AI generated variation" className="generated-image" />
                                </div>
                             ) : (
                                <div className="generated-image-wrapper variation-placeholder">
                                    <button className="generate-variation-button" onClick={() => onGenerateVariation(reference)}>
                                        Generate Variation
                                    </button>
                                </div>
                             )}
                             {variationError && <p className="generation-error small">{variationError}</p>}
                        </div>
                    </div>
                )}
                {status === 'to-generate' && (
                    <>
                        {isGeneratingPrompts && (
                            <div className="loading-prompts">
                                <InlineSpinner />
                                <span>Generating creative prompts...</span>
                            </div>
                        )}
                        {proposedPrompts && !isGeneratingPrompts && (
                            <div className="proposed-prompts">
                                <div className="prompt-option">
                                    <strong>Option 1:</strong>
                                    <p>{proposedPrompts[0]}</p>
                                </div>
                                <div className="prompt-option">
                                    <strong>Option 2:</strong>
                                    <p>{proposedPrompts[1]}</p>
                                </div>
                            </div>
                        )}
                         {isGeneratingImages && (
                            <div className="generation-result is-loading">
                                <div className="loading-images-header">
                                    <InlineSpinner />
                                    <span>Generating images... This may take a moment.</span>
                                </div>
                                <button className="context-button" disabled>See context</button>
                                <div className="generated-images-container">
                                    <div className="generated-image-wrapper skeleton" aria-busy="true" aria-label="Loading image 1"></div>
                                    <div className="generated-image-wrapper skeleton" aria-busy="true" aria-label="Loading image 2"></div>
                                </div>
                            </div>
                        )}
                        {generationError && <p className="generation-error">{generationError}</p>}
                        {generatedImages && (
                            <div className="generation-result">
                                <button className="context-button" onClick={() => onOpenContext(context)}>
                                    See context
                                </button>
                                <div className="generated-images-container">
                                    {generatedImages[0] ? (
                                        <div className="generated-image-wrapper">
                                            <img src={generatedImages[0]} alt="Generated image option 1" className="generated-image" />
                                        </div>
                                    ) : <div className="generated-image-wrapper placeholder">Image 1 failed</div>}
                                    {generatedImages[1] ? (
                                        <div className="generated-image-wrapper">
                                            <img src={generatedImages[1]} alt="Generated image option 2" className="generated-image" />
                                        </div>
                                    ) : <div className="generated-image-wrapper placeholder">Image 2 failed</div>}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

const fileToGenerativePart = async (file: File): Promise<Part> => {
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

const generateContentWithRetry = async (
    ai: GoogleGenAI,
    request: { model: string; contents: string },
    retries = 5,
    delay = 1000
): Promise<GenerateContentResponse> => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await ai.models.generateContent(request);
            return response;
        } catch (error) {
            console.error(`Gemini API call attempt ${i + 1} of ${retries} failed:`, error);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw new Error('Failed to generate content after all retries.');
};

const generateImageFromPrompt = async (ai: GoogleGenAI, prompt: string, styleImagePart?: Part): Promise<string> => {
    let contents;
    let config;

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

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image-preview",
        contents,
        ...(config && { config }),
    });

    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            const imageData = part.inlineData.data;
            const mimeType = part.inlineData.mimeType || 'image/png';
            return `data:${mimeType};base64,${imageData}`;
        }
    }
    throw new Error("API did not return an image. It may have refused the prompt.");
};

const generateImageVariation = async (ai: GoogleGenAI, base64ImageWithMime: string, altText: string): Promise<string> => {
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

    const response = await ai.models.generateContent({
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

const App = () => {
    const [markdownFile, setMarkdownFile] = useState<File | null>(null);
    const [styleImageFile, setStyleImageFile] = useState<File | null>(null);
    const [maintainStyle, setMaintainStyle] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [markdownError, setMarkdownError] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [imageReferences, setImageReferences] = useState<ImageReference[]>([]);
    const [templates, setTemplates] = useState<{ context: string; description: string; } | null>(null);
    const [templateError, setTemplateError] = useState('');
    const promptCache = useRef(new Map<string, ImageReference[]>());

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalContent, setModalContent] = useState('');

    const openModal = (content: string) => {
        setModalContent(content);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setModalContent('');
    };

    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const [contextRes, descriptionRes] = await Promise.all([
                    fetch('./context_to_description.txt'),
                    fetch('./description_to_nano_prompt.txt')
                ]);

                if (!contextRes.ok || !descriptionRes.ok) {
                    throw new Error('Failed to load prompt templates. Check network tab for details.');
                }

                const contextTemplate = await contextRes.text();
                const descriptionTemplate = await descriptionRes.text();
                
                setTemplates({ context: contextTemplate, description: descriptionTemplate });
            } catch (error) {
                console.error("Error loading templates:", error);
                setTemplateError('Could not load required prompt templates. Please refresh the page.');
            }
        };
        loadTemplates();
    }, []);

    const handleMarkdownSelect = async (file: File) => {
        setMarkdownFile(null);
        setMarkdownError('');
        setImageReferences([]);

        if (file.name.endsWith('.md')) {
            setMarkdownFile(file);
            return;
        }

        if (file.name.endsWith('.zip')) {
            try {
                const zip = await JSZip.loadAsync(file);
                const fileNames = Object.keys(zip.files);
                const hasMarkdown = fileNames.some(fileName => !zip.files[fileName].dir && fileName.endsWith('.md'));

                if (hasMarkdown) {
                    setMarkdownFile(file);
                } else {
                    setMarkdownError('The .zip file must contain at least one .md file.');
                }
            } catch (e) {
                console.error("Error reading zip file:", e);
                setMarkdownError('Could not read the .zip file. It may be corrupt.');
            }
            return;
        }

        setMarkdownError('Invalid file type. Please upload a .md or .zip file.');
    };

    const handlePropose = async () => {
        if (!markdownFile || !templates) return;
        setIsLoading(true);
        setMarkdownError('');

        try {
            let markdownContent = '';
            let zip: JSZip | null = null;
            let zipFilePaths: string[] = [];
            const isZip = markdownFile.name.endsWith('.zip');

            if (isZip) {
                zip = await JSZip.loadAsync(markdownFile);
                zipFilePaths = Object.keys(zip.files).filter(name => !zip.files[name].dir);
                const mdFileEntry = Object.values(zip.files).find(
                    file => !file.dir && file.name.endsWith('.md')
                );

                if (mdFileEntry) {
                    markdownContent = await mdFileEntry.async('string');
                } else {
                    setMarkdownError('No .md file found in the .zip archive.');
                    return;
                }
            } else {
                markdownContent = await markdownFile.text();
            }
            
            if (promptCache.current.has(markdownContent)) {
                setImageReferences(promptCache.current.get(markdownContent)!);
                return;
            }

            const references: ImageReference[] = [];
            const markdownRegex = /!\[([^\]]*)\]\((.*?)\)/g;
            let match;

            while ((match = markdownRegex.exec(markdownContent)) !== null) {
                const [fullMatch, rawAlt, rawPath] = match;
                const pathParts = rawPath.split(/\s+(?=["'])/, 2);
                let path = pathParts[0].trim();
                if (path.startsWith('<') && path.endsWith('>')) {
                    path = path.slice(1, -1);
                }
                path = path.replace(/\\(.)/g, '$1');
                const alt = rawAlt.replace(/\\(.)/g, '$1');
                const matchIndex = match.index;
                const contentBeforeMatch = markdownContent.substring(0, matchIndex);
                const lineNumber = (contentBeforeMatch.match(/\n/g) || []).length + 1;
                const contextStart = Math.max(0, matchIndex - 500);
                const contextEnd = Math.min(markdownContent.length, matchIndex + fullMatch.length + 500);
                const context = markdownContent.substring(contextStart, contextEnd);

                let status: ImageReference['status'] = 'to-generate';
                let originalImage: string | undefined = undefined;

                if (isZip && zip) {
                    const normalizedPath = path.startsWith('./') ? path.substring(2) : path;
                    const imageFileInZipPath = zipFilePaths.find(p => p.endsWith(normalizedPath));
                    if (imageFileInZipPath && zip.files[imageFileInZipPath]) {
                        status = 'existing';
                        const fileEntry = zip.files[imageFileInZipPath];
                        const base64Data = await fileEntry.async('base64');
                        const extension = imageFileInZipPath.split('.').pop()?.toLowerCase() || '';
                        let mimeType = 'image/png';
                        if (['jpg', 'jpeg'].includes(extension)) mimeType = 'image/jpeg';
                        else if (extension === 'gif') mimeType = 'image/gif';
                        else if (extension === 'webp') mimeType = 'image/webp';
                        originalImage = `data:${mimeType};base64,${base64Data}`;
                    }
                }
                references.push({ lineNumber, alt, path, context, status, originalImage });
            }

            const htmlImgRegex = /<img([^>]+)>/gi;
            while ((match = htmlImgRegex.exec(markdownContent)) !== null) {
                const [fullMatch, attrsString] = match;
                if (!attrsString) continue;
                const srcMatch = attrsString.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
                const altMatch = attrsString.match(/alt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i);
                const path = srcMatch ? srcMatch[1] || srcMatch[2] || srcMatch[3] : null;

                if (path) {
                    const alt = altMatch ? altMatch[1] || altMatch[2] || altMatch[3] || '' : '';
                    const matchIndex = match.index;
                    const contentBeforeMatch = markdownContent.substring(0, matchIndex);
                    const lineNumber = (contentBeforeMatch.match(/\n/g) || []).length + 1;
                    const contextStart = Math.max(0, matchIndex - 500);
                    const contextEnd = Math.min(markdownContent.length, matchIndex + fullMatch.length + 500);
                    const context = markdownContent.substring(contextStart, contextEnd);
                    
                    let status: ImageReference['status'] = 'to-generate';
                    let originalImage: string | undefined = undefined;

                    if (isZip && zip) {
                        const normalizedPath = path.startsWith('./') ? path.substring(2) : path;
                        const imageFileInZipPath = zipFilePaths.find(p => p.endsWith(normalizedPath));
                        if (imageFileInZipPath && zip.files[imageFileInZipPath]) {
                            status = 'existing';
                            const fileEntry = zip.files[imageFileInZipPath];
                            const base64Data = await fileEntry.async('base64');
                            const extension = imageFileInZipPath.split('.').pop()?.toLowerCase() || '';
                            let mimeType = 'image/png';
                            if (['jpg', 'jpeg'].includes(extension)) mimeType = 'image/jpeg';
                            else if (extension === 'gif') mimeType = 'image/gif';
                            else if (extension === 'webp') mimeType = 'image/webp';
                            originalImage = `data:${mimeType};base64,${base64Data}`;
                        }
                    }
                    references.push({ lineNumber, alt, path, context, status, originalImage });
                }
            }

            references.sort((a, b) => a.lineNumber - b.lineNumber);
            setImageReferences(references);

            const toGenerateList = references.filter(ref => ref.status === 'to-generate');
            if (toGenerateList.length > 0) {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                let finalReferencesForCache = [...references];

                for (const ref of toGenerateList) {
                    setImageReferences(prevRefs => 
                        prevRefs.map(r => r.lineNumber === ref.lineNumber && r.path === ref.path ? { ...r, isGeneratingPrompts: true } : r)
                    );

                    let promptForGemini = '';
                    if (ref.alt) {
                        promptForGemini = templates.description.replace('{alt_text}', ref.alt);
                    } else {
                        promptForGemini = templates.context
                            .replace('{file_content}', markdownContent)
                            .replace('{context}', ref.context);
                    }
                    
                    const response = await generateContentWithRetry(ai, {
                        model: 'gemini-2.5-flash',
                        contents: promptForGemini,
                    });

                    const text = response.text;
                    const parsePromptsFromResponse = (responseText: string): [string, string] | undefined => {
                        const prompt1Match = responseText.match(/<prompt_1>([\s\S]*?)<\/prompt_1>/);
                        const prompt2Match = responseText.match(/<prompt_2>([\s\S]*?)<\/prompt_2>/);
                        if (prompt1Match && prompt2Match) {
                            const prompt1 = prompt1Match[1].trim();
                            const prompt2 = prompt2Match[1].trim();
                            return [prompt1, prompt2];
                        }
                        console.warn('Could not parse prompts from Gemini response:', responseText);
                        return undefined;
                    };

                    const proposedPrompts = parsePromptsFromResponse(text);
                    finalReferencesForCache = finalReferencesForCache.map(cacheRef => {
                        if (cacheRef.lineNumber === ref.lineNumber && cacheRef.path === ref.path) {
                            return { ...cacheRef, proposedPrompts: proposedPrompts ?? ['', ''] };
                        }
                        return cacheRef;
                    });

                    setImageReferences(prevRefs => 
                        prevRefs.map(r => 
                            r.lineNumber === ref.lineNumber && r.path === ref.path 
                            ? { ...r, isGeneratingPrompts: false, proposedPrompts: proposedPrompts ?? ['', ''] } 
                            : r
                        )
                    );
                }
                promptCache.current.set(markdownContent, finalReferencesForCache);
            } else {
                promptCache.current.set(markdownContent, references);
            }
        } catch (error) {
            console.error("Error processing file or generating prompts:", error);
            setMarkdownError('Failed to parse file or generate prompts. Check console for details.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleGenerateImages = async () => {
        const itemsToProcess = imageReferences.filter(
            ref => ref.status === 'to-generate' && ref.proposedPrompts && !ref.generatedImages
        );
    
        if (itemsToProcess.length === 0) return;
    
        let styleImageForBatch: string | null = null;
        // Pre-check for an existing image if maintainStyle is on
        if (maintainStyle && !styleImageFile) {
            const anyExistingGenerated = imageReferences.find(r => (r.generatedImages && (r.generatedImages[0] || r.generatedImages[1])) || r.generatedVariation);
            if (anyExistingGenerated) {
                if (anyExistingGenerated.generatedImages) {
                     styleImageForBatch = anyExistingGenerated.generatedImages[0] || anyExistingGenerated.generatedImages[1];
                } else {
                    styleImageForBatch = anyExistingGenerated.generatedVariation!;
                }
            }
        }
    
        for (const referenceToGenerate of itemsToProcess) {
            setImageReferences(prev => prev.map(ref => 
                (ref.lineNumber === referenceToGenerate.lineNumber && ref.path === referenceToGenerate.path) 
                ? { ...ref, isGeneratingImages: true, generationError: undefined } 
                : ref
            ));
    
            try {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                let [prompt1, prompt2] = referenceToGenerate.proposedPrompts!;
    
                let styleImagePart: Part | undefined = undefined;
                if (styleImageFile) {
                    styleImagePart = await fileToGenerativePart(styleImageFile);
                } else if (maintainStyle && styleImageForBatch) {
                    const mimeType = styleImageForBatch.substring(styleImageForBatch.indexOf(":") + 1, styleImageForBatch.indexOf(";"));
                    const data = styleImageForBatch.split(',')[1];
                    styleImagePart = { inlineData: { mimeType, data } };
                }
    
                if (styleImagePart) {
                    prompt1 += " -- in the artistic style of the provided image.";
                    prompt2 += " -- in the artistic style of the provided image.";
                }
    
                const results = await Promise.allSettled([
                    generateImageFromPrompt(ai, prompt1, styleImagePart),
                    generateImageFromPrompt(ai, prompt2, styleImagePart)
                ]);
    
                const generatedImages: [string | null, string | null] = [null, null];
                let anyError = false;
    
                if (results[0].status === 'fulfilled') {
                    generatedImages[0] = results[0].value;
                } else {
                    console.error("Error generating image 1:", results[0].reason);
                    anyError = true;
                }
    
                if (results[1].status === 'fulfilled') {
                    generatedImages[1] = results[1].value;
                } else {
                    console.error("Error generating image 2:", results[1].reason);
                    anyError = true;
                }
    
                // After generation, if this is the first one, set it as the style reference for subsequent items in this batch
                if (maintainStyle && !styleImageFile && !styleImageForBatch) {
                    if (generatedImages[0]) {
                        styleImageForBatch = generatedImages[0];
                    } else if (generatedImages[1]) {
                        styleImageForBatch = generatedImages[1];
                    }
                }
                
                setImageReferences(prev => prev.map(ref => 
                    (ref.lineNumber === referenceToGenerate.lineNumber && ref.path === referenceToGenerate.path) 
                    ? { 
                        ...ref, 
                        isGeneratingImages: false, 
                        generatedImages,
                        generationError: anyError ? "Failed to generate one or more images. See console for details." : undefined
                      } 
                    : ref
                ));
    
            } catch (error) {
                console.error("General error during image generation:", error);
                setImageReferences(prev => prev.map(ref => 
                    (ref.lineNumber === referenceToGenerate.lineNumber && ref.path === referenceToGenerate.path) 
                    ? { ...ref, isGeneratingImages: false, generationError: "An unexpected error occurred during image generation." } 
                    : ref
                ));
            }
        }
    };

    const handleGenerateVariation = async (referenceToUpdate: ImageReference) => {
        if (!referenceToUpdate.originalImage || referenceToUpdate.isGeneratingVariation) return;

        setImageReferences(prev => prev.map(ref => 
            (ref.lineNumber === referenceToUpdate.lineNumber && ref.path === referenceToUpdate.path) 
            ? { ...ref, isGeneratingVariation: true, variationError: undefined } 
            : ref
        ));

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const variation = await generateImageVariation(ai, referenceToUpdate.originalImage, referenceToUpdate.alt);
            
            setImageReferences(prev => prev.map(ref => 
                (ref.lineNumber === referenceToUpdate.lineNumber && ref.path === referenceToUpdate.path) 
                ? { 
                    ...ref, 
                    isGeneratingVariation: false, 
                    generatedVariation: variation,
                  } 
                : ref
            ));

        } catch (error) {
            console.error("Error during image variation generation:", error);
            setImageReferences(prev => prev.map(ref => 
                (ref.lineNumber === referenceToUpdate.lineNumber && ref.path === referenceToUpdate.path) 
                ? { ...ref, isGeneratingVariation: false, variationError: "Failed to generate variation. See console." } 
                : ref
            ));
        }
    };

    const existingImagesCount = imageReferences.filter(ref => ref.status === 'existing').length;
    const toGenerateImagesCount = imageReferences.filter(ref => ref.status === 'to-generate').length;
    const pendingGenerationCount = imageReferences.filter(ref => ref.status === 'to-generate' && ref.proposedPrompts && !ref.generatedImages).length;
    const isGeneratingAnyImage = imageReferences.some(ref => ref.isGeneratingImages);

    return (
        <main className="app-container">
            <Modal isOpen={isModalOpen} onClose={closeModal} content={modalContent} />
            <header>
                <h1>BananaMD</h1>
                <p>Generate illustrations for your Markdown documents.</p>
            </header>

            <section className="upload-section">
                <DropZone
                    id="markdown-upload"
                    onFileSelect={handleMarkdownSelect}
                    acceptedTypes=".md,.zip"
                    file={markdownFile}
                    label="Markdown or .zip file"
                    dragLabel="Drop your document here"
                    error={markdownError || templateError}
                />
            </section>

            <section className="advanced-options">
                <button
                    className="advanced-options-toggle"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    aria-expanded={showAdvanced}
                    aria-controls="advanced-options-content"
                >
                    <span>Advanced Options</span>
                    <ChevronIcon expanded={showAdvanced} />
                </button>
                <div className={`advanced-options-content ${showAdvanced ? 'show' : ''}`} id="advanced-options-content" hidden={!showAdvanced}>
                    <DropZone
                        id="style-image-upload"
                        onFileSelect={setStyleImageFile}
                        acceptedTypes="image/*"
                        file={styleImageFile}
                        label="Style reference (optional)"
                        dragLabel="Drop a style image"
                        error=""
                    />
                     <div className="options">
                        <label htmlFor="maintain-style-checkbox" className="checkbox-container">
                            <input
                                type="checkbox"
                                id="maintain-style-checkbox"
                                checked={maintainStyle}
                                onChange={(e) => setMaintainStyle(e.target.checked)}
                            />
                            <span className="checkbox-custom"><CheckIcon /></span>
                            Try to maintain the style of the first image
                        </label>
                    </div>
                </div>
            </section>
            
            {imageReferences.length > 0 && !isLoading && (
              <section className="results-section">
                <div className="results-summary">
                    {existingImagesCount > 0 && (
                        <p className="progress-indicator">
                            Found {existingImagesCount} existing image{existingImagesCount !== 1 ? 's' : ''} to create variations for.
                        </p>
                    )}
                     {toGenerateImagesCount > 0 && (
                        <p className="progress-indicator">
                            Found {toGenerateImagesCount} image placeholder{toGenerateImagesCount !== 1 ? 's' : ''} to illustrate.
                        </p>
                    )}
                </div>
                <div className="image-reference-list">
                  {imageReferences.map((ref) => (
                    <ImageReferenceItem key={`${ref.lineNumber}-${ref.path}`} reference={ref} onOpenContext={openModal} onGenerateVariation={handleGenerateVariation} />
                  ))}
                </div>
              </section>
            )}

            <div className="propose-section">
                {isLoading ? (
                    <Spinner />
                ) : imageReferences.length > 0 ? (
                    <div className="generation-step">
                        <button 
                            className="propose-button"
                            onClick={handleGenerateImages}
                            disabled={pendingGenerationCount === 0 || isGeneratingAnyImage}
                            aria-disabled={pendingGenerationCount === 0 || isGeneratingAnyImage}
                        >
                            {isGeneratingAnyImage 
                                ? 'Generating...' 
                                : pendingGenerationCount > 1
                                    ? `Generate All ${pendingGenerationCount} Images`
                                    : 'Generate Image'
                            }
                        </button>
                    </div>
                ) : (
                    <button
                        className="propose-button"
                        onClick={handlePropose}
                        disabled={!markdownFile || !templates}
                        aria-disabled={!markdownFile || !templates}
                    >
                        Propose illustrative images
                    </button>
                )}
            </div>
        </main>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
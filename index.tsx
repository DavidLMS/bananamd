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
    // FIX: Corrected a typo in the viewBox attribute. It had an extra ' 24"' which broke JSX parsing.
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
                        {isGeneratingPrompts && !generationError && (
                            <div className="loading-prompts">
                                <InlineSpinner />
                                <span>Analyzing context to generate prompts...</span>
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

type GenAIRequest = Parameters<GoogleGenAI['models']['generateContent']>[0];

const generateContentWithRetry = async (
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

const generateImageFromPrompt = async (ai: GoogleGenAI, prompt: string, styleImagePart?: Part): Promise<string> => {
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

const App = () => {
    const [markdownFile, setMarkdownFile] = useState<File | null>(null);
    const [markdownContent, setMarkdownContent] = useState<string | null>(null);
    const [styleImageFile, setStyleImageFile] = useState<File | null>(null);
    const [maintainStyle, setMaintainStyle] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [markdownError, setMarkdownError] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [imageReferences, setImageReferences] = useState<ImageReference[]>([]);
    const [currentReferenceIndex, setCurrentReferenceIndex] = useState<number | null>(null);
    const generationTriggered = useRef(new Set<number>());

    const [templates, setTemplates] = useState<{ context: string; description: string; } | null>(null);
    const [templateError, setTemplateError] = useState('');

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
        setMarkdownContent(null);
        setMarkdownError('');
        setImageReferences([]);
        setCurrentReferenceIndex(null);

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

    const parseAndFindReferences = async () => {
        if (!markdownFile) return;
        setIsParsing(true);
        setMarkdownError('');
        setImageReferences([]);
        setCurrentReferenceIndex(null);
        generationTriggered.current.clear();

        try {
            let currentMarkdownContent = '';
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
                    currentMarkdownContent = await mdFileEntry.async('string');
                } else {
                    throw new Error('No .md file found in the .zip archive.');
                }
            } else {
                currentMarkdownContent = await markdownFile.text();
            }
            setMarkdownContent(currentMarkdownContent);

            const references: ImageReference[] = [];
            const markdownRegex = /!\[([^\]]*)\]\((.*?)\)/g;
            let match;

            while ((match = markdownRegex.exec(currentMarkdownContent)) !== null) {
                const [fullMatch, rawAlt, rawPath] = match;
                const pathParts = rawPath.split(/\s+(?=["'])/, 2);
                let path = pathParts[0].trim();
                if (path.startsWith('<') && path.endsWith('>')) path = path.slice(1, -1);
                path = path.replace(/\\(.)/g, '$1');
                const alt = rawAlt.replace(/\\(.)/g, '$1');
                const matchIndex = match.index;
                const contentBeforeMatch = currentMarkdownContent.substring(0, matchIndex);
                const lineNumber = (contentBeforeMatch.match(/\n/g) || []).length + 1;
                const contextStart = Math.max(0, matchIndex - 500);
                const contextEnd = Math.min(currentMarkdownContent.length, matchIndex + fullMatch.length + 500);
                const context = currentMarkdownContent.substring(contextStart, contextEnd);

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
            while ((match = htmlImgRegex.exec(currentMarkdownContent)) !== null) {
                const [fullMatch, attrsString] = match;
                if (!attrsString) continue;
                const srcMatch = attrsString.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
                const altMatch = attrsString.match(/alt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i);
                const path = srcMatch ? srcMatch[1] || srcMatch[2] || srcMatch[3] : null;

                if (path) {
                    const alt = altMatch ? altMatch[1] || altMatch[2] || altMatch[3] || '' : '';
                    const matchIndex = match.index;
                    const contentBeforeMatch = currentMarkdownContent.substring(0, matchIndex);
                    const lineNumber = (contentBeforeMatch.match(/\n/g) || []).length + 1;
                    const contextStart = Math.max(0, matchIndex - 500);
                    const contextEnd = Math.min(currentMarkdownContent.length, matchIndex + fullMatch.length + 500);
                    const context = currentMarkdownContent.substring(contextStart, contextEnd);
                    
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
            if(references.length > 0) {
                setCurrentReferenceIndex(0);
            }

        } catch (error) {
            console.error("Error processing markdown file:", error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during processing.';
            setMarkdownError(message);
        } finally {
            setIsParsing(false);
        }
    };
    
    useEffect(() => {
        const triggerGenerationForIndex = async (index: number) => {
            if (generationTriggered.current.has(index)) return;
            
            const ref = imageReferences[index];
            if (!ref || ref.status !== 'to-generate' || ref.generatedImages || ref.generationError) return;

            generationTriggered.current.add(index);
            
            try {
                if (!templates || !markdownContent) throw new Error("Templates or markdown file not ready.");
                
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                let styleImagePart: Part | undefined;
                if (styleImageFile) {
                     try {
                        styleImagePart = await fileToGenerativePart(styleImageFile);
                    } catch (e) {
                        console.error("Could not process style image:", e);
                    }
                }

                // Step 1: Generate Prompts
                setImageReferences(prev => prev.map((r, i) => i === index ? { ...r, isGeneratingPrompts: true, generationError: '' } : r));

                const generatePrompts = async (currentRef: ImageReference): Promise<[string, string]> => {
                    let template = currentRef.alt ? templates.description : templates.context;
                    let prompt = currentRef.alt 
                        ? template.replace('{alt_text}', currentRef.alt)
                        : template.replace('{file_content}', markdownContent).replace('{context}', currentRef.context);
                    
                    const response = await generateContentWithRetry(ai, { model: "gemini-2.5-flash", contents: prompt });
                    const responseText = response.text.trim();
                    const prompt1Match = responseText.match(/<prompt_1>([\s\S]*?)<\/prompt_1>/);
                    const prompt2Match = responseText.match(/<prompt_2>([\s\S]*?)<\/prompt_2>/);
                    if (!prompt1Match || !prompt2Match) throw new Error("Could not parse prompts from the AI response.");
                    return [prompt1Match[1].trim(), prompt2Match[1].trim()];
                };
                
                const prompts = await generatePrompts(ref);
                
                setImageReferences(prev => prev.map((r, i) => i === index ? { ...r, isGeneratingPrompts: false, proposedPrompts: prompts, isGeneratingImages: true } : r));

                // Step 2: Generate Images
                const imagePromises = prompts.map(p => 
                    generateImageFromPrompt(ai, p, styleImagePart).catch(e => {
                        console.error(`Image generation failed for prompt: "${p}"`, e);
                        return null;
                    })
                );
                const [image1, image2] = await Promise.all(imagePromises);

                setImageReferences(prev => prev.map((r, i) => i === index ? { ...r, isGeneratingImages: false, generatedImages: [image1, image2] } : r));
            } catch (error) {
                console.error(`Failed to process image for L${ref.lineNumber} (path: ${ref.path}):`, error);
                const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during generation.";
                setImageReferences(prev => prev.map((r, i) => i === index ? { ...r, isGeneratingPrompts: false, isGeneratingImages: false, generationError: errorMessage } : r));
            }
        };

        if (currentReferenceIndex !== null) {
            triggerGenerationForIndex(currentReferenceIndex);
        }
    }, [currentReferenceIndex, imageReferences, templates, markdownContent, styleImageFile]);

    const handleGenerateVariation = async (refToUpdate: ImageReference) => {
        if (!refToUpdate.originalImage) return;
    
        setImageReferences(prev => prev.map(r => r.lineNumber === refToUpdate.lineNumber ? { ...r, isGeneratingVariation: true, variationError: '' } : r));
    
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const variation = await generateImageVariation(ai, refToUpdate.originalImage, refToUpdate.alt);
            setImageReferences(prev => prev.map(r => r.lineNumber === refToUpdate.lineNumber ? { ...r, isGeneratingVariation: false, generatedVariation: variation } : r));
        } catch (error) {
            console.error(`Failed to generate variation for L${refToUpdate.lineNumber}:`, error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            setImageReferences(prev => prev.map(r => r.lineNumber === refToUpdate.lineNumber ? { ...r, isGeneratingVariation: false, variationError: errorMessage } : r));
        }
    };

    const handlePrevious = () => {
        if (currentReferenceIndex !== null) {
            setCurrentReferenceIndex(Math.max(0, currentReferenceIndex - 1));
        }
    };
    
    const handleNext = () => {
        if (currentReferenceIndex !== null) {
            setCurrentReferenceIndex(Math.min(imageReferences.length - 1, currentReferenceIndex + 1));
        }
    };

    return (
        <div className="app-container">
            <header>
                <h1>BananaMD</h1>
                <p>Illustrate your Markdown documents with AI-generated images.</p>
            </header>

            {templateError && <p className="error-text">{templateError}</p>}

            <div className="upload-section">
                <DropZone
                    id="markdown-upload"
                    onFileSelect={handleMarkdownSelect}
                    acceptedTypes=".md,.zip"
                    file={markdownFile}
                    label="Upload a .md file or a .zip archive containing your project."
                    dragLabel="Drop your Markdown file here"
                    error={markdownError}
                />
            </div>

            <div className="advanced-options">
                <button 
                    className="advanced-options-toggle"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    aria-expanded={showAdvanced}
                    aria-controls="advanced-content"
                >
                    Advanced Options
                    <ChevronIcon expanded={showAdvanced} />
                </button>
                <div id="advanced-content" className={`advanced-options-content ${showAdvanced ? 'show' : ''}`}>
                    <div className="upload-section">
                         <DropZone
                            id="style-image-upload"
                            onFileSelect={setStyleImageFile}
                            acceptedTypes="image/png,image/jpeg,image/webp"
                            file={styleImageFile}
                            label="Upload a style reference image (optional)."
                            dragLabel="Drop style image here"
                            error={''}
                        />
                    </div>
                    <div className="options">
                        <label className="checkbox-container">
                            <input
                                type="checkbox"
                                checked={maintainStyle}
                                onChange={(e) => setMaintainStyle(e.target.checked)}
                                disabled // This option is for variations, maybe it should be inside the item? For now, let's keep it simple.
                            />
                            <span className="checkbox-custom">
                                <CheckIcon />
                            </span>
                            Maintain original image style (for variations)
                        </label>
                    </div>
                </div>
            </div>
            
            <div className="propose-section">
                {isParsing ? (
                    <div className="generation-step">
                        <div className="spinner-container">
                            <Spinner />
                        </div>
                        <p className="generation-status-indicator">Parsing Markdown and finding image references...</p>
                    </div>
                ) : (
                    <button
                        className="propose-button"
                        onClick={parseAndFindReferences}
                        disabled={!markdownFile || isParsing}
                    >
                        {imageReferences.length > 0 ? 'Start Over' : 'Find Images & Generate'}
                    </button>
                )}
            </div>

            {currentReferenceIndex !== null && imageReferences.length > 0 && (
                <section className="results-section">
                    <div className="results-navigation">
                        <button className="nav-button" onClick={handlePrevious} disabled={currentReferenceIndex === 0}>
                            Previous
                        </button>
                        <span>
                            Image {currentReferenceIndex + 1} of {imageReferences.length}
                        </span>
                        <button className="nav-button" onClick={handleNext} disabled={currentReferenceIndex === imageReferences.length - 1}>
                            Next
                        </button>
                    </div>
                    <div className="image-reference-list">
                        <ImageReferenceItem 
                            key={imageReferences[currentReferenceIndex].lineNumber + imageReferences[currentReferenceIndex].path}
                            reference={imageReferences[currentReferenceIndex]}
                            onOpenContext={openModal}
                            onGenerateVariation={handleGenerateVariation}
                        />
                    </div>
                </section>
            )}
            
            <Modal isOpen={isModalOpen} onClose={closeModal} content={modalContent} />
        </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
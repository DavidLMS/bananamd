import React, { useState, useCallback, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { GoogleGenAI, type Part } from "@google/genai";
import { CheckIcon, ChevronIcon } from './components/icons';
import { Spinner } from './components/spinners';
import { Modal } from './components/Modal';
import { DropZone } from './components/DropZone';
import { ImageReferenceItem, type ImageReference } from './components/ImageReferenceItem';
import { fileToGenerativePart, generateContentWithRetry, generateImageFromPrompt, generateImageVariation } from './services/genai';

export const App = () => {
    const [view, setView] = useState<'upload' | 'generation'>('upload');
    const [markdownFile, setMarkdownFile] = useState<File | null>(null);
    const [markdownContent, setMarkdownContent] = useState<string | null>(null);
    const [styleImageFile, setStyleImageFile] = useState<File | null>(null);
    const [styleReferenceImage, setStyleReferenceImage] = useState<Part | undefined>(undefined);
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

    const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
    const [promptModalContent, setPromptModalContent] = useState('');

    const openModal = (content: string) => {
        setModalContent(content);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setModalContent('');
    };

    const openPromptModal = (prompt: string) => {
        setPromptModalContent(prompt);
        setIsPromptModalOpen(true);
    };

    const closePromptModal = () => {
        setIsPromptModalOpen(false);
        setPromptModalContent('');
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
                const pathParts = rawPath.split(/\s+(?=[\"'])/, 2);
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
                setView('generation');
            }

        } catch (error) {
            console.error("Error processing markdown file:", error);
            const message = error instanceof Error ? error.message : 'An unexpected error occurred during processing.';
            setMarkdownError(message);
        } finally {
            setIsParsing(false);
        }
    };

    const handleStartOver = () => {
        setView('upload');
        setMarkdownFile(null);
        setMarkdownContent(null);
        setStyleImageFile(null);
        setMaintainStyle(false);
        setImageReferences([]);
        setCurrentReferenceIndex(null);
        setMarkdownError('');
        generationTriggered.current.clear();
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
                let styleImagePart: Part | undefined = styleReferenceImage;
                if (!styleImagePart && styleImageFile) {
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

    const handleNext = useCallback(() => {
        if (currentReferenceIndex !== null) {
            setCurrentReferenceIndex(Math.min(imageReferences.length - 1, currentReferenceIndex + 1));
        }
    }, [currentReferenceIndex, imageReferences.length]);

    const handleImageSelect = useCallback((imageIndex: number) => {
        if (currentReferenceIndex === null) return;

        if (maintainStyle && currentReferenceIndex === 0 && !styleReferenceImage) {
            const selectedImage = imageReferences[currentReferenceIndex].generatedImages?.[imageIndex];
            if (selectedImage) {
                const mimeType = selectedImage.substring(selectedImage.indexOf(":") + 1, selectedImage.indexOf(";"));
                const data = selectedImage.split(',')[1];
                setStyleReferenceImage({ inlineData: { mimeType, data } });
            }
        }

        const updatedReferences = [...imageReferences];
        updatedReferences[currentReferenceIndex].selectedIndex = imageIndex;
        setImageReferences(updatedReferences);

        setTimeout(() => {
            handleNext();
        }, 300); // Small delay to show selection before advancing
    }, [currentReferenceIndex, imageReferences, handleNext, maintainStyle, styleReferenceImage]);

    const handleRegenerateImage = async (imageIndex: number) => {
        if (currentReferenceIndex === null) return;

        const updatedReferences = [...imageReferences];
        updatedReferences[currentReferenceIndex].isRetrying = true;
        setImageReferences(updatedReferences);

        const reference = imageReferences[currentReferenceIndex];
        const prompt = reference.proposedPrompts?.[imageIndex];

        if (!prompt) {
            console.error("Could not find prompt for regeneration.");
            updatedReferences[currentReferenceIndex].isRetrying = false;
            setImageReferences(updatedReferences);
            return;
        }

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            let styleImagePart: Part | undefined;
            if (styleImageFile) {
                try {
                    styleImagePart = await fileToGenerativePart(styleImageFile);
                } catch (e) {
                    console.error("Could not process style image:", e);
                }
            }

            const newImage = await generateImageFromPrompt(ai, prompt, styleImagePart);

            if (updatedReferences[currentReferenceIndex].generatedImages) {
                updatedReferences[currentReferenceIndex].generatedImages![imageIndex] = newImage;
            }

        } catch (error) {
            console.error(`Failed to regenerate image for L${reference.lineNumber}:`, error);
        } finally {
            updatedReferences[currentReferenceIndex].isRetrying = false;
            setImageReferences(updatedReferences);
        }
    };

    const handlePrevious = () => {
        if (currentReferenceIndex !== null) {
            setCurrentReferenceIndex(Math.max(0, currentReferenceIndex - 1));
        }
    };
    
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (view !== 'generation' || currentReferenceIndex === null) return;

            if (event.key === 'ArrowLeft') {
                handleImageSelect(0);
            }
            if (event.key === 'ArrowRight') {
                handleImageSelect(1);
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [view, currentReferenceIndex, handleImageSelect]);

    return (
        <div className="app-container">
            <header>
                <h1>BananaMD</h1>
                <p>Illustrate your Markdown documents with AI-generated images.</p>
            </header>

            {templateError && <p className="error-text">{templateError}</p>}

            {view === 'upload' && (
                <>
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
                                    disabled={maintainStyle && styleReferenceImage}
                                />
                            </div>
                            <div className="options">
                                <label className="checkbox-container">
                                    <input
                                        type="checkbox"
                                        checked={maintainStyle}
                                        onChange={(e) => setMaintainStyle(e.target.checked)}
                                        disabled={currentReferenceIndex !== null && currentReferenceIndex > 0}
                                    />
                                    <span className="checkbox-custom">
                                        <CheckIcon />
                                    </span>
                                    Try to maintain the style of the first image
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
                                Find Images & Generate
                            </button>
                        )}
                    </div>
                </>
            )}

            {view === 'generation' && currentReferenceIndex !== null && imageReferences.length > 0 && (
                <section className="results-section">
                    <div className="results-navigation">
                        <button className="nav-button" onClick={handleStartOver}>Start Over</button>
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
                            onSelect={handleImageSelect}
                            onOpenPrompt={openPromptModal}
                            onRegenerate={handleRegenerateImage}
                        />
                    </div>
                </section>
            )}
            
            <Modal isOpen={isModalOpen} onClose={closeModal} content={modalContent} />
            <Modal isOpen={isPromptModalOpen} onClose={closePromptModal} content={promptModalContent} title="Generation Prompt" />
        </div>
    );
};
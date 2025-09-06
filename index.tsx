
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';
import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

const UploadIcon = () => (
    <svg className="drop-zone-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
);

const CheckIcon = () => (
    // FIX: Corrected malformed viewBox attribute. The extra quote was breaking JSX parsing.
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
}

const ImageReferenceItem = ({ reference }: { reference: ImageReference }) => {
    const { path, alt, lineNumber, status, isGeneratingPrompts, proposedPrompts } = reference;
    
    return (
        <div className={`image-reference-item status-${status}`} aria-live="polite">
            <div className="item-header">
                <span className="item-path" title={path}>{path}</span>
                <span className="item-line">L{lineNumber}</span>
            </div>
            {alt && <p className="item-alt">Alt: "{alt}"</p>}
            
            <div className="item-body">
                {status === 'existing' && (
                    <p className="status-text">Existing image. No action needed.</p>
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
                    </>
                )}
            </div>
        </div>
    );
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
                throw error; // Re-throw the error on the last attempt
            }
        }
    }
    // This part is unreachable if the loop logic is correct, but satisfies TypeScript's return type requirement.
    throw new Error('Failed to generate content after all retries.');
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
            let zipFilePaths: string[] = [];
            const isZip = markdownFile.name.endsWith('.zip');

            if (isZip) {
                const zip = await JSZip.loadAsync(markdownFile);
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
                return; // finally will set isLoading to false
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
                if (isZip) {
                    const normalizedPath = path.startsWith('./') ? path.substring(2) : path;
                    const exists = zipFilePaths.some(p => p.endsWith(normalizedPath));
                    if (exists) {
                        status = 'existing';
                    }
                }
                references.push({ lineNumber, alt, path, context, status });
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
                     if (isZip) {
                        const normalizedPath = path.startsWith('./') ? path.substring(2) : path;
                        const exists = zipFilePaths.some(p => p.endsWith(normalizedPath));
                        if (exists) {
                            status = 'existing';
                        }
                    }
                    references.push({ lineNumber, alt, path, context, status });
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
    
    const existingImagesCount = imageReferences.filter(ref => ref.status === 'existing').length;
    const toGenerateImagesCount = imageReferences.filter(ref => ref.status === 'to-generate').length;

    return (
        <main className="app-container">
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
                            Found {existingImagesCount} existing image{existingImagesCount !== 1 ? 's' : ''}.
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
                    <ImageReferenceItem key={`${ref.lineNumber}-${ref.path}`} reference={ref} />
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
                            disabled={toGenerateImagesCount === 0}
                            aria-disabled={toGenerateImagesCount === 0}
                        >
                            Generate {toGenerateImagesCount > 0 ? `${toGenerateImagesCount} ` : ''}Image{toGenerateImagesCount !== 1 ? 's' : ''}
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

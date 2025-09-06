import React from 'react';
import { InlineSpinner } from './spinners';

export interface ImageReference {
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
    selectedIndex?: number | null;
}

interface ImageReferenceItemProps {
    reference: ImageReference;
    onOpenContext: (context: string) => void;
    onGenerateVariation: (ref: ImageReference) => void;
    onSelect: (index: number) => void;
    onOpenPrompt: (prompt: string) => void;
}

export const ImageReferenceItem = ({ reference, onOpenContext, onGenerateVariation, onSelect, onOpenPrompt }: ImageReferenceItemProps) => {
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
                                    {generatedImages[0] && reference.proposedPrompts?.[0] ? (
                                        <div className={`generated-image-wrapper ${reference.selectedIndex === 0 ? 'selected' : ''}`} onClick={() => onSelect(0)}>
                                            <img src={generatedImages[0]} alt="Generated image option 1" className="generated-image" />
                                            <button className="info-button" onClick={(e) => { e.stopPropagation(); onOpenPrompt(reference.proposedPrompts![0]); }}>i</button>
                                        </div>
                                    ) : <div className="generated-image-wrapper placeholder">Image 1 failed</div>}
                                    {generatedImages[1] && reference.proposedPrompts?.[1] ? (
                                        <div className={`generated-image-wrapper ${reference.selectedIndex === 1 ? 'selected' : ''}`} onClick={() => onSelect(1)}>
                                            <img src={generatedImages[1]} alt="Generated image option 2" className="generated-image" />
                                            <button className="info-button" onClick={(e) => { e.stopPropagation(); onOpenPrompt(reference.proposedPrompts![1]); }}>i</button>
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
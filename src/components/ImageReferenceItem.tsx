import React from 'react';
import { InlineSpinner } from './spinners';

export interface ImageReference {
    lineNumber: number;
    alt: string;
    path: string;
    context: string;
    // Export helpers
    startIndex?: number;
    matchLength?: number;
    syntax?: 'markdown' | 'html';
    status: 'existing' | 'to-generate';
    isGeneratingPrompts?: boolean;
    proposedPrompts?: [string, string];
    isGeneratingImages?: boolean;
    generatedImages?: [string | null, string | null];
    generationError?: string;
    originalImage?: string;
    // Existing image flow
    isGeneratingImproved?: boolean;
    generatedImproved?: string | null;
    improvedError?: string;
    isGeneratingVariation?: boolean;
    generatedVariation?: string | null;
    variationError?: string;
    selectedIndex?: number | null;
    isRetrying?: boolean;
    histories?: [ImageHistory | null, ImageHistory | null];
    loadErrors?: [boolean, boolean];
}

export interface ImageVersionNode {
    id: string;
    imageData: string;
    parentId: string | null;
    childrenIds: string[];
    createdAt: number;
    instruction?: string;
}

export interface ImageHistory {
    nodes: Record<string, ImageVersionNode>;
    rootId: string;
    currentId: string;
    order: string[];
    isEditing?: boolean;
    error?: string;
}

interface ImageReferenceItemProps {
    reference: ImageReference;
    onOpenContext: (context: string) => void;
    onGenerateVariation: (ref: ImageReference) => void;
    onSelect: (index: number) => void;
    onOpenPrompt: (prompt: string) => void;
    onRegenerate: (imageIndex: number) => void;
    onEditInstruction: (imageIndex: 0 | 1, instruction: string) => void;
    onNavigateHistory: (imageIndex: 0 | 1, direction: 'prev' | 'next') => void;
    onImageError: (imageIndex: 0 | 1) => void;
}

export const ImageReferenceItem = ({ reference, onOpenContext, onGenerateVariation, onSelect, onOpenPrompt, onRegenerate, onEditInstruction, onNavigateHistory, onImageError }: ImageReferenceItemProps) => {
    const { 
        path, alt, lineNumber, status, context,
        isGeneratingPrompts, proposedPrompts,
        isGeneratingImages, generatedImages, generationError,
        originalImage, isGeneratingVariation, generatedVariation, variationError,
        histories
    } = reference;

    const renderVersionBadge = (history?: ImageHistory | null) => {
        if (!history) return null;
        const idx = history.order.indexOf(history.currentId);
        const current = idx >= 0 ? idx + 1 : 1;
        const total = history.order.length || 1;
        return (
            <div className="version-badge" title={`Version ${current} of ${total}`}>
                {current}/{total}
            </div>
        );
    };

    const renderNavArrows = (history?: ImageHistory | null, imageIndex?: 0 | 1) => {
        if (!history || imageIndex === undefined) return null;
        const idx = history.order.indexOf(history.currentId);
        const hasPrev = idx > 0;
        const hasNext = idx >= 0 && idx < history.order.length - 1;
        if (!hasPrev && !hasNext) return null;
        return (
            <div className="version-nav">
                <button className="nav-arrow left" disabled={!hasPrev} onClick={(e) => { e.stopPropagation(); onNavigateHistory(imageIndex, 'prev'); }} aria-label="Previous version">&#8592;</button>
                <button className="nav-arrow right" disabled={!hasNext} onClick={(e) => { e.stopPropagation(); onNavigateHistory(imageIndex, 'next'); }} aria-label="Next version">&#8594;</button>
            </div>
        );
    };

    const EditInput = ({ imageIndex }: { imageIndex: 0 | 1 }) => {
        const [value, setValue] = React.useState('');
        const history = histories?.[imageIndex];
        const isEditing = history?.isEditing;
        const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && value.trim()) {
                onEditInstruction(imageIndex, value.trim());
                setValue('');
            }
        };
        return (
            <div className="edit-panel">
                <input
                    className="edit-input"
                    type="text"
                    placeholder={isEditing ? 'Editing…' : 'Type edit instructions and press Enter'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={!!isEditing}
                />
                {history?.error && <span className="edit-error">{history.error}</span>}
            </div>
        );
    };

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
                            <h4 className="column-label">Improved</h4>
                            {reference.isGeneratingImproved ? (
                                <div className="generated-image-wrapper skeleton" aria-busy="true" aria-label="Improving image"></div>
                            ) : (reference.generatedImproved || originalImage) ? (
                                <>
                                    <div className={`generated-image-wrapper ${reference.selectedIndex === 0 ? 'selected' : ''}`} onClick={() => onSelect(0)}>
                                        {renderVersionBadge(histories?.[0])}
                                        {renderNavArrows(histories?.[0], 0)}
                                    <img
                                        src={histories?.[0] ? histories[0]!.nodes[histories[0]!.currentId].imageData : (reference.generatedImproved || originalImage)!}
                                        alt="Improved image"
                                        className="generated-image"
                                        onError={() => onImageError(0)}
                                    />
                                    </div>
                                    <EditInput imageIndex={0} />
                                </>
                            ) : (
                                <div className="generated-image-wrapper placeholder">
                                    Cannot load image.
                                </div>
                            )}
                            {reference.improvedError && <p className="generation-error small">{reference.improvedError}</p>}
                        </div>
                        <div className="image-column">
                             <h4 className="column-label">AI Variation</h4>
                             {isGeneratingVariation ? (
                                 <div className="generated-image-wrapper skeleton" aria-busy="true" aria-label="Loading variation"></div>
                             ) : generatedVariation ? (
                                <>
                                    <div className={`generated-image-wrapper ${reference.selectedIndex === 1 ? 'selected' : ''}`} onClick={() => onSelect(1)}>
                                        {renderVersionBadge(histories?.[1])}
                                        {renderNavArrows(histories?.[1], 1)}
                                    <img
                                        src={histories?.[1] ? histories[1]!.nodes[histories[1]!.currentId].imageData : generatedVariation}
                                        alt="AI generated variation"
                                        className="generated-image"
                                        onError={() => onImageError(1)}
                                    />
                                    </div>
                                    <EditInput imageIndex={1} />
                                </>
                             ) : (
                                 <div className="generated-image-wrapper variation-placeholder">
                                     <span>Preparing variation…</span>
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
                                    {generatedImages[0] && reference.proposedPrompts?.[0] && !reference.loadErrors?.[0] ? (
                                        <div className="image-column">
                                        <div className={`generated-image-wrapper ${reference.selectedIndex === 0 ? 'selected' : ''}`} onClick={() => onSelect(0)}>
                                            {renderVersionBadge(histories?.[0])}
                                            {renderNavArrows(histories?.[0], 0)}
                                            <img src={histories?.[0] ? histories[0]!.nodes[histories[0]!.currentId].imageData : generatedImages[0]!} alt="Generated image option 1" className="generated-image" onError={(e) => { e.stopPropagation(); onImageError(0); }} />
                                            <button className="info-button" onClick={(e) => { e.stopPropagation(); onOpenPrompt(reference.proposedPrompts![0]); }}>i</button>
                                        </div>
                                        <EditInput imageIndex={0} />
                                        </div>
                                    ) : (
                                        <div className="generated-image-wrapper placeholder">
                                            Image 1 failed
                                            {reference.isRetrying ? <InlineSpinner /> : <button className="retry-button" onClick={(e) => { e.stopPropagation(); onRegenerate(0); }}>Try again</button>}
                                        </div>
                                    )}
                                    {generatedImages[1] && reference.proposedPrompts?.[1] && !reference.loadErrors?.[1] ? (
                                        <div className="image-column">
                                        <div className={`generated-image-wrapper ${reference.selectedIndex === 1 ? 'selected' : ''}`} onClick={() => onSelect(1)}>
                                            {renderVersionBadge(histories?.[1])}
                                            {renderNavArrows(histories?.[1], 1)}
                                            <img src={histories?.[1] ? histories[1]!.nodes[histories[1]!.currentId].imageData : generatedImages[1]!} alt="Generated image option 2" className="generated-image" onError={(e) => { e.stopPropagation(); onImageError(1); }} />
                                            <button className="info-button" onClick={(e) => { e.stopPropagation(); onOpenPrompt(reference.proposedPrompts![1]); }}>i</button>
                                        </div>
                                        <EditInput imageIndex={1} />
                                        </div>
                                    ) : (
                                        <div className="generated-image-wrapper placeholder">
                                            Image 2 failed
                                            {reference.isRetrying ? <InlineSpinner /> : <button className="retry-button" onClick={(e) => { e.stopPropagation(); onRegenerate(1); }}>Try again</button>}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

import React, { useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import JSZip from 'jszip';

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

const App = () => {
    const [markdownFile, setMarkdownFile] = useState<File | null>(null);
    const [styleImageFile, setStyleImageFile] = useState<File | null>(null);
    const [maintainStyle, setMaintainStyle] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [markdownError, setMarkdownError] = useState('');
    const [showAdvanced, setShowAdvanced] = useState(false);

    const handleMarkdownSelect = async (file: File) => {
        setMarkdownFile(null); // Reset on new selection
        setMarkdownError('');

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

    const handlePropose = () => {
        if (!markdownFile) return;
        setIsLoading(true);
        // AI generation logic will go here in the future
        console.log({
            markdownFile,
            styleImageFile,
            maintainStyle,
        });
        // Simulate processing delay
        setTimeout(() => {
            setIsLoading(false);
        }, 3000);
    };

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
                    error={markdownError}
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

            <div className="propose-section">
                {isLoading ? (
                    <Spinner />
                ) : (
                    <button
                        className="propose-button"
                        onClick={handlePropose}
                        disabled={!markdownFile}
                        aria-disabled={!markdownFile}
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
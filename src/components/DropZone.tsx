import React, { useState, useRef, useEffect } from 'react';
import { UploadIcon } from './icons';

interface DropZoneProps {
    id: string;
    onFileSelect: (file: File | null) => void;
    acceptedTypes: string;
    file: File | null;
    label: string;
    dragLabel: string;
    error: string;
    disabled?: boolean;
}

export const DropZone = ({ id, onFileSelect, acceptedTypes, file, label, dragLabel, error, disabled }: DropZoneProps) => {
    const [isDragging, setIsDragging] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Generate a local preview if the selected file is an image
    useEffect(() => {
        if (file && file.type && file.type.startsWith('image/')) {
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            return () => URL.revokeObjectURL(url);
        }
        setPreviewUrl(null);
    }, [file]);

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            onFileSelect(files[0]);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (disabled) return;
        const files = e.target.files;
        if (files && files.length > 0) {
            onFileSelect(files[0]);
        }
    };

    const handleRemove = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (disabled) return;
        onFileSelect(null);
        if (inputRef.current) inputRef.current.value = '';
    };

    const handleClick = () => {
        if (disabled) return;
        inputRef.current?.click();
    }

    return (
        <div
            className={`drop-zone ${isDragging ? 'drag-over' : ''} ${error ? 'has-error' : ''} ${disabled ? 'disabled' : ''}`}
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
                previewUrl ? (
                    <div className="file-preview">
                        <img className="drop-zone-preview" src={previewUrl} alt={file.name} />
                        <p className="file-name">{file.name}</p>
                        <button className="remove-button" onClick={handleRemove} aria-label="Remove file">Remove</button>
                    </div>
                ) : (
                    <div className="file-preview">
                        {/* simple file info for non-images */}
                        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            {/* lightweight inline icon to avoid extra deps */}
                            <span className="file-icon" aria-hidden>📄</span>
                            <p className="file-name">
                                {file.name}
                                <span className="file-size"> ({(file.size/1024).toFixed(1)} KB)</span>
                            </p>
                        </div>
                        <button className="remove-button" onClick={handleRemove} aria-label="Remove file">Remove</button>
                    </div>
                )
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

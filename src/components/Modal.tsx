import React from 'react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    content: string;
    title?: string;
}

export const Modal = ({ isOpen, onClose, content, title = "Markdown Context" }: ModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>{title}</h3>
                    <button className="modal-close-button" onClick={onClose} aria-label="Close modal">&times;</button>
                </div>
                <div className="modal-body">
                    <pre><code>{content}</code></pre>
                </div>
            </div>
        </div>
    );
};
import React, { useState, useCallback, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { GoogleGenAI, type Part } from "@google/genai";
import { CheckIcon, ChevronIcon } from './components/icons';
import { Spinner } from './components/spinners';
import { Modal } from './components/Modal';
import { DropZone } from './components/DropZone';
import { ImageReferenceItem, type ImageReference, type ImageHistory, type ImageVersionNode } from './components/ImageReferenceItem';
import { fileToGenerativePart, generateContentWithRetry, generateImageFromPrompt, generateImageVariation, generateEditedImage } from './services/genai';

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
    const [mdBaseName, setMdBaseName] = useState<string>('document.md');
    const [currentReferenceIndex, setCurrentReferenceIndex] = useState<number | null>(null);
    const generationTriggered = useRef(new Set<number>());
    const exportTriggered = useRef(false);

    const [templates, setTemplates] = useState<{ context: string; description: string; naming: string; imageDescribe: string; } | null>(null);
    const [templateError, setTemplateError] = useState('');

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalContent, setModalContent] = useState('');

    const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
    const [promptModalContent, setPromptModalContent] = useState('');

    // Export state
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');
    const [exportPreview, setExportPreview] = useState('');
    const [zipUrl, setZipUrl] = useState<string | null>(null);
    const [zipAllUrl, setZipAllUrl] = useState<string | null>(null);

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

    const allImagesSelected = React.useMemo(() => {
        if (!imageReferences.length) return false;
        return imageReferences.every(ref => {
            const idx = ref.selectedIndex;
            if (idx === undefined || idx === null) return false;
            if (ref.status === 'to-generate') {
                const hist = ref.histories?.[idx] || null;
                const img = hist ? hist.nodes[hist.currentId].imageData : ref.generatedImages?.[idx] || null;
                return !!img;
            } else {
                if (idx === 0) {
                    const hist = ref.histories?.[0] || null;
                    const img = hist ? hist.nodes[hist.currentId].imageData : (ref.generatedImproved || null);
                    return !!img;
                } else {
                    const hist = ref.histories?.[1] || null;
                    const img = hist ? hist.nodes[hist.currentId].imageData : ref.generatedVariation || null;
                    return !!img;
                }
            }
        });
    }, [imageReferences]);

    // Auto-trigger export when all images have been selected
    useEffect(() => {
        if (allImagesSelected && !exportTriggered.current && !exporting && !zipUrl) {
            exportTriggered.current = true;
            handleBuildExports();
        }
    }, [allImagesSelected, exporting, zipUrl]);

    const getSelectedImageData = (ref: ImageReference): { img: string; idx: number; promptHint: string } => {
        const idx = ref.status === 'to-generate' ? (ref.selectedIndex as number) : (ref.selectedIndex ?? 0);
        let img: string | null | undefined = null;
        if (ref.status === 'to-generate') {
            const hist = ref.histories?.[idx] || null;
            img = hist ? hist.nodes[hist.currentId].imageData : (ref.generatedImages?.[idx] || null);
        } else {
            if (idx === 0) {
                const hist = ref.histories?.[0] || null;
                img = hist ? hist.nodes[hist.currentId].imageData : (ref.generatedImproved || null);
            } else {
                const hist = ref.histories?.[1] || null;
                img = hist ? hist.nodes[hist.currentId].imageData : (ref.generatedVariation || null);
            }
        }
        const promptHint = ref.proposedPrompts?.[idx] || ref.alt || '';
        return { img: img as string, idx, promptHint };
    };

    const parseDataUrl = (dataUrl: string): { mimeType: string; base64: string } => {
        const mimeType = dataUrl.substring(dataUrl.indexOf(":") + 1, dataUrl.indexOf(";"));
        const base64 = dataUrl.split(',')[1] || '';
        return { mimeType, base64 };
    };
    const extFromMime = (mime: string): string => {
        if (mime.includes('png')) return 'png';
        if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
        if (mime.includes('webp')) return 'webp';
        if (mime.includes('gif')) return 'gif';
        return 'png';
    };
    const sanitizeSlug = (s: string): string => {
        const cleaned = s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-');
        return cleaned || 'image';
    };

    const createFilenameAndDescription = async (
        ai: GoogleGenAI,
        ref: ImageReference,
        promptHint: string,
        imageDataUrl: string
    ): Promise<{ slug: string; alt: string }> => {
        if (!templates?.naming) throw new Error('Naming template not loaded');
        const tmpl = templates.naming
            .replace('{context}', ref.context || '')
            .replace('{user_alt}', ref.alt || '')
            .replace('{prompt_hint}', promptHint || '');
        const { mimeType, base64 } = parseDataUrl(imageDataUrl);
        const imagePart = { inlineData: { mimeType, data: base64 } } as any;
        const resp = await generateContentWithRetry(ai, {
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, { text: tmpl }] },
        });
        const txt = typeof (resp as any).text === 'function' ? await (resp as any).text() : String((resp as any).text || '');
        const filenameMatch = txt.match(/<filename>([\s\S]*?)<\/filename>/);
        const descMatch = txt.match(/<description>([\s\S]*?)<\/description>/);
        const rawSlug = sanitizeSlug((filenameMatch?.[1] || '').trim());
        const alt = (descMatch?.[1] || '').trim();
        return { slug: rawSlug || 'image', alt: alt || ref.alt || 'Illustrative image' };
    };

    

    const handleBuildExports = async () => {
        if (!markdownContent) return;
        setExporting(true);
        setExportError('');
        setExportPreview('');
        setZipUrl(null);
        setZipAllUrl(null);
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const zip = new JSZip();
            const imagesFolder = zip.folder('images');

            // Sort references by startIndex for deterministic replacement order
            const sorted = [...imageReferences].sort((a, b) => (a.startIndex || 0) - (b.startIndex || 0));

            const fileInfos: { ref: ImageReference; filename: string; alt: string; relPath: string }[] = [];
            const slugByRef = new Map<number, string>();

            for (const ref of sorted) {
                const { img, promptHint } = getSelectedImageData(ref);
                const { mimeType, base64 } = parseDataUrl(img);
                const { slug, alt } = await createFilenameAndDescription(ai, ref, promptHint, img);
                const ext = extFromMime(mimeType);
                // Add line number prefix to avoid collisions and keep context
                const filename = `${ref.lineNumber}-${slug}.${ext}`;
                slugByRef.set(ref.lineNumber, slug);
                imagesFolder!.file(filename, base64, { base64: true });
                fileInfos.push({ ref, filename, alt, relPath: `images/${filename}` });
            }

            // Rebuild Markdown content with new alts and image paths
            let cursor = 0;
            let rebuilt = '';
            for (const info of sorted.map(r => fileInfos.find(f => f.ref === r)!)) {
                const start = info.ref.startIndex || 0;
                const end = start + (info.ref.matchLength || 0);
                rebuilt += markdownContent.slice(cursor, start);
                if (info.ref.syntax === 'markdown') {
                    rebuilt += `![${info.alt}](${info.relPath})`;
                } else {
                    const original = markdownContent.slice(start, end);
                    let replaced = original.replace(/src\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)/i, `src="${info.relPath}"`);
                    if (/alt\s*=\s*/i.test(replaced)) {
                        replaced = replaced.replace(/alt\s*=\s*(?:\"[^\"]*\"|'[^']*'|[^\s>]+)/i, `alt="${info.alt}"`);
                    } else {
                        replaced = replaced.replace(/<img/i, `<img alt="${info.alt}"`);
                    }
                    rebuilt += replaced;
                }
                cursor = end;
            }
            rebuilt += markdownContent.slice(cursor);

            // Add updated markdown file
            zip.file(mdBaseName, rebuilt);

            // Build optional ZIP with all generated images
            const zipAll = new JSZip();
            const allFolder = zipAll.folder('images');
            const addedSet = new Set<string>();
            const toAdd = (name: string, dataUrl: string) => {
                const { base64 } = parseDataUrl(dataUrl);
                if (!addedSet.has(name)) {
                    allFolder!.file(name, base64, { base64: true });
                    addedSet.add(name);
                }
            };
            for (const ref of sorted) {
                const baseSlug = slugByRef.get(ref.lineNumber) || `${ref.lineNumber}-image`;
                const collect = (dataUrl: string | null | undefined, suffix: string) => {
                    if (!dataUrl) return;
                    const { mimeType } = parseDataUrl(dataUrl);
                    const ext = extFromMime(mimeType);
                    const fname = `${ref.lineNumber}-${baseSlug}-${suffix}.${ext}`;
                    toAdd(fname, dataUrl);
                };
                if (ref.status === 'to-generate') {
                    // both initial options
                    collect(ref.generatedImages?.[0], 'option1');
                    collect(ref.generatedImages?.[1], 'option2');
                    // histories for both slots
                    const h0 = ref.histories?.[0];
                    if (h0) {
                        h0.order.forEach((id, idx) => collect(h0.nodes[id].imageData, `hist0-v${idx + 1}`));
                    }
                    const h1 = ref.histories?.[1];
                    if (h1) {
                        h1.order.forEach((id, idx) => collect(h1.nodes[id].imageData, `hist1-v${idx + 1}`));
                    }
                } else {
                    collect(ref.originalImage, 'original');
                    collect(ref.generatedVariation, 'variation');
                    const h0 = ref.histories?.[0];
                    if (h0) {
                        h0.order.forEach((id, idx) => collect(h0.nodes[id].imageData, `hist0-v${idx + 1}`));
                    }
                    const h1 = ref.histories?.[1];
                    if (h1) {
                        h1.order.forEach((id, idx) => collect(h1.nodes[id].imageData, `hist1-v${idx + 1}`));
                    }
                }
            }

            const [blobMain, blobAll] = await Promise.all([
                zip.generateAsync({ type: 'blob' }),
                zipAll.generateAsync({ type: 'blob' })
            ]);

            const mainUrl = URL.createObjectURL(blobMain);
            const allUrl = URL.createObjectURL(blobAll);
            setZipUrl(mainUrl);
            setZipAllUrl(allUrl);
            setExportPreview(rebuilt);
        } catch (e: any) {
            console.error('Export failed:', e);
            setExportError(e?.message || 'Export failed');
        } finally {
            setExporting(false);
        }
    };

    useEffect(() => {
        const loadTemplates = async () => {
            try {
                const [contextRes, descriptionRes, namingRes, imageDescribeRes] = await Promise.all([
                    fetch('./context_to_description.txt'),
                    fetch('./description_to_nano_prompt.txt'),
                    fetch('./image_to_filename_description.txt'),
                    fetch('./image_to_description.txt')
                ]);

                if (!contextRes.ok || !descriptionRes.ok || !namingRes.ok || !imageDescribeRes.ok) {
                    throw new Error('Failed to load prompt templates. Check network tab for details.');
                }

                const contextTemplate = await contextRes.text();
                const descriptionTemplate = await descriptionRes.text();
                const namingTemplate = await namingRes.text();
                const imageDescribeTemplate = await imageDescribeRes.text();
                
                setTemplates({ context: contextTemplate, description: descriptionTemplate, naming: namingTemplate, imageDescribe: imageDescribeTemplate });
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
                    const base = (mdFileEntry.name.split('/').pop() || 'document.md');
                    setMdBaseName(base);
                } else {
                    throw new Error('No .md file found in the .zip archive.');
                }
            } else {
                currentMarkdownContent = await markdownFile.text();
                setMdBaseName(markdownFile.name);
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
                references.push({ lineNumber, alt, path, context, status, originalImage, startIndex: matchIndex, matchLength: fullMatch.length, syntax: 'markdown' });
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
                    references.push({ lineNumber, alt, path, context, status, originalImage, startIndex: matchIndex, matchLength: fullMatch.length, syntax: 'html' });
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
        // reset export
        setExporting(false);
        setExportError('');
        setExportPreview('');
        setZipUrl(null);
        setZipAllUrl(null);
        exportTriggered.current = false;
    };
    
    useEffect(() => {
        const triggerGenerationForIndex = async (index: number) => {
            if (generationTriggered.current.has(index)) return;
            
            const ref = imageReferences[index];
            if (!ref) return;

            generationTriggered.current.add(index);
            
            try {
                if (!templates || !markdownContent) throw new Error("Templates or markdown file not ready.");
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                let styleImagePart: Part | undefined = styleReferenceImage;
                if (!styleImagePart && styleImageFile) {
                    try { styleImagePart = await fileToGenerativePart(styleImageFile); } catch (e) { console.error("Could not process style image:", e); }
                }

                // Branch: existing image → left: improve; right: new-from-description
                if (ref.status === 'existing') {
                    setImageReferences(prev => prev.map((r, i) => i === index ? { ...r, isGeneratingImproved: true, improvedError: '', isGeneratingVariation: true, variationError: '' } : r));

                    // Left image: improved/stylized version of the original (uses explicit base+style variation path)
                    const improveInstruction = ref.alt || '';
                    const improvedRaw = await generateImageVariation(
                        ai,
                        ref.originalImage!,
                        improveInstruction,
                        styleImagePart
                    ).catch(e => {
                        console.error('Improve failed:', e);
                        return null;
                    });

                    const normalizeImage = (img: string | null): string | null => {
                        if (!img || typeof img !== 'string') return null;
                        const looksLikeDataUrl = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(img);
                        if (!looksLikeDataUrl) return null;
                        if (img.length < 200) return null;
                        return img;
                    };
                    const improved = normalizeImage(improvedRaw);

                    // Right image: new-from-description
                    let describeText = '';
                    try {
                        const imagePart = (() => {
                            const { mimeType, base64 } = parseDataUrl(ref.originalImage!);
                            return { inlineData: { mimeType, data: base64 } } as any;
                        })();
                        const describePrompt = templates.imageDescribe
                            .replace('{context}', ref.context || '')
                            .replace('{user_alt}', ref.alt || '');
                        const describeResp = await generateContentWithRetry(ai, { model: 'gemini-2.5-flash', contents: { parts: [imagePart, { text: describePrompt }] } });
                        const textOut = typeof (describeResp as any).text === 'function' ? await (describeResp as any).text() : String((describeResp as any).text || '');
                        describeText = textOut.trim();
                    } catch (e) {
                        console.error('Describe image failed:', e);
                    }

                    let newPrompt = '';
                    try {
                        const tpl = templates.description.replace('{alt_text}', describeText || ref.alt || '');
                        const resp = await generateContentWithRetry(ai, { model: 'gemini-2.5-flash', contents: tpl });
                        const txt = typeof (resp as any).text === 'function' ? await (resp as any).text() : String((resp as any).text || '');
                        const prompt1Match = txt.match(/<prompt_1>([\s\S]*?)<\/prompt_1>/);
                        newPrompt = (prompt1Match?.[1] || '').trim();
                    } catch (e) {
                        console.error('Prompt from description failed:', e);
                    }

                    const rightRaw = newPrompt ? await generateImageFromPrompt(ai, newPrompt, styleImagePart).catch(e => { console.error('New image generation failed:', e); return null; }) : null;
                    const right = normalizeImage(rightRaw);

                    setImageReferences(prev => prev.map((r, i) => {
                        if (i !== index) return r;
                        // Init histories
                        const histories: [ImageHistory | null, ImageHistory | null] = [null, null];
                        if (improved) {
                            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                            const node: ImageVersionNode = { id, imageData: improved, parentId: null, childrenIds: [], createdAt: Date.now() };
                            histories[0] = { nodes: { [id]: node }, rootId: id, currentId: id, order: [id] };
                        }
                        if (right) {
                            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                            const node: ImageVersionNode = { id, imageData: right, parentId: null, childrenIds: [], createdAt: Date.now() };
                            histories[1] = { nodes: { [id]: node }, rootId: id, currentId: id, order: [id] };
                        }
                        return { ...r, isGeneratingImproved: false, isGeneratingVariation: false, generatedImproved: improved || null, generatedVariation: right || null, histories };
                    }));
                    return;
                }

                // Default branch: to-generate → generate 2 proposals
                // Step 1: Generate Prompts
                setImageReferences(prev => prev.map((r, i) => i === index ? { ...r, isGeneratingPrompts: true, generationError: '' } : r));

                const generatePrompts = async (currentRef: ImageReference): Promise<[string, string]> => {
                    let template = currentRef.alt ? templates.description : templates.context;
                    let prompt = currentRef.alt 
                        ? template.replace('{alt_text}', currentRef.alt)
                        : template.replace('{file_content}', markdownContent).replace('{context}', currentRef.context);
                    
                    const response = await generateContentWithRetry(ai, { model: "gemini-2.5-flash", contents: prompt });
                    const textOut = typeof (response as any).text === 'function'
                        ? await (response as any).text()
                        : String((response as any).text || '');
                    const responseText = textOut.trim();
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
                const [rawImage1, rawImage2] = await Promise.all(imagePromises);

                const normalizeImage = (img: string | null): string | null => {
                    if (!img || typeof img !== 'string') return null;
                    const looksLikeDataUrl = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(img);
                    if (!looksLikeDataUrl) return null;
                    // Basic size sanity check to avoid empty payloads that render invisibly
                    if (img.length < 200) return null;
                    return img;
                };
                const image1 = normalizeImage(rawImage1);
                const image2 = normalizeImage(rawImage2);

                const createInitialHistory = (img: string | null | undefined): ImageHistory | null => {
                    if (!img) return null;
                    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const node: ImageVersionNode = {
                        id,
                        imageData: img,
                        parentId: null,
                        childrenIds: [],
                        createdAt: Date.now(),
                    };
                    return {
                        nodes: { [id]: node },
                        rootId: id,
                        currentId: id,
                        order: [id],
                    };
                };

                setImageReferences(prev => prev.map((r, i) => {
                    if (i !== index) return r;
                    const histories: [ImageHistory | null, ImageHistory | null] = [
                        createInitialHistory(image1),
                        createInitialHistory(image2)
                    ];
                    return { ...r, isGeneratingImages: false, generatedImages: [image1, image2], histories };
                }));
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
            let styleImagePart: Part | undefined = styleReferenceImage;
            if (!styleImagePart && styleImageFile) {
                try {
                    styleImagePart = await fileToGenerativePart(styleImageFile);
                } catch (e) {
                    console.error("Could not process style image:", e);
                }
            }
            const variationRaw = await generateImageVariation(ai, refToUpdate.originalImage, refToUpdate.alt, styleImagePart);
            const normalizeImage = (img: string | null): string | null => {
                if (!img || typeof img !== 'string') return null;
                const looksLikeDataUrl = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(img);
                if (!looksLikeDataUrl) return null;
                if (img.length < 200) return null;
                return img;
            };
            const variation = normalizeImage(variationRaw);
            setImageReferences(prev => prev.map(r => {
                if (r.lineNumber !== refToUpdate.lineNumber) return r;
                // Initialize history for variation slot (index 1)
                const histories = r.histories ? [...r.histories] as [ImageHistory | null, ImageHistory | null] : [null, null];
                if (!histories[1] && variation) {
                    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const node: ImageVersionNode = { id, imageData: variation, parentId: null, childrenIds: [], createdAt: Date.now() };
                    histories[1] = { nodes: { [id]: node }, rootId: id, currentId: id, order: [id] };
                }
                return { ...r, isGeneratingVariation: false, generatedVariation: variation, histories };
            }));
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

        // If maintaining style and first selection, capture the picked image as style reference
        if (maintainStyle && currentReferenceIndex === 0 && !styleReferenceImage) {
            const ref = imageReferences[currentReferenceIndex];
            let selectedImage: string | null | undefined = null;
            if (ref.status === 'to-generate') {
                // Prefer history current if exists, else the generated option
                const history = ref.histories?.[imageIndex] || null;
                selectedImage = history ? history.nodes[history.currentId].imageData : ref.generatedImages?.[imageIndex];
            } else {
                // existing: 0=original, 1=variation
                if (imageIndex === 0) {
                    const history = ref.histories?.[0] || null;
                    selectedImage = history ? history.nodes[history.currentId].imageData : (ref.originalImage || null);
                } else {
                    const history = ref.histories?.[1] || null;
                    selectedImage = history ? history.nodes[history.currentId].imageData : (ref.generatedVariation || null);
                }
            }
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
            let styleImagePart: Part | undefined = styleReferenceImage;
            if (!styleImagePart && styleImageFile) {
                try {
                    styleImagePart = await fileToGenerativePart(styleImageFile);
                } catch (e) {
                    console.error("Could not process style image:", e);
                }
            }

            const newImageRaw = await generateImageFromPrompt(ai, prompt, styleImagePart);
            const normalizeImage = (img: string | null): string | null => {
                if (!img || typeof img !== 'string') return null;
                const looksLikeDataUrl = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(img);
                if (!looksLikeDataUrl) return null;
                if (img.length < 200) return null;
                return img;
            };
            const newImage = normalizeImage(newImageRaw);

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

    const handleEditInstruction = async (imageIndex: 0 | 1, instruction: string) => {
        if (currentReferenceIndex === null) return;
        const ref = imageReferences[currentReferenceIndex];
        if (!ref) return;

        const updated = [...imageReferences];
        // Ensure history exists for the chosen image index
        if (!updated[currentReferenceIndex].histories) {
            const initHistory = (img: string | null | undefined): ImageHistory | null => {
                if (!img) return null;
                const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const node: ImageVersionNode = { id, imageData: img, parentId: null, childrenIds: [], createdAt: Date.now() };
                return { nodes: { [id]: node }, rootId: id, currentId: id, order: [id] };
            };
            // Determine base images depending on status
            const base0 = updated[currentReferenceIndex].status === 'existing'
                ? (updated[currentReferenceIndex].generatedImproved || updated[currentReferenceIndex].originalImage || null)
                : (updated[currentReferenceIndex].generatedImages?.[0] || null);
            const base1 = updated[currentReferenceIndex].status === 'existing'
                ? (updated[currentReferenceIndex].generatedVariation || null)
                : (updated[currentReferenceIndex].generatedImages?.[1] || null);
            updated[currentReferenceIndex].histories = [initHistory(base0), initHistory(base1)];
        }

        const histories = updated[currentReferenceIndex].histories!;
        const history = histories[imageIndex];
        if (!history) return;

        // Mark editing
        history.isEditing = true;
        history.error = '';
        setImageReferences(updated);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const currentNode = history.nodes[history.currentId];
            const branchKey = `${ref.lineNumber}-${imageIndex}-${currentNode.id}`;
            let styleImagePart: Part | undefined = styleReferenceImage;
            if (!styleImagePart && styleImageFile) {
                try {
                    styleImagePart = await fileToGenerativePart(styleImageFile);
                } catch (e) {
                    console.error("Could not process style image:", e);
                }
            }
            const editedImageRaw = await generateEditedImage(ai, branchKey, currentNode.imageData, instruction, styleImagePart);
            const normalizeImage = (img: string | null): string | null => {
                if (!img || typeof img !== 'string') return null;
                const looksLikeDataUrl = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(img);
                if (!looksLikeDataUrl) return null;
                if (img.length < 200) return null;
                return img;
            };
            const editedImage = normalizeImage(editedImageRaw) || currentNode.imageData;

            // Create new node
            const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const newNode: ImageVersionNode = {
                id: newId,
                imageData: editedImage,
                parentId: currentNode.id,
                childrenIds: [],
                createdAt: Date.now(),
                instruction,
            };
            // Link to parent
            currentNode.childrenIds.push(newId);
            history.nodes[newId] = newNode;
            history.order.push(newId);
            history.currentId = newId;
        } catch (e: any) {
            console.error('Edit failed:', e);
            history.error = e?.message || 'Edit failed';
        } finally {
            history.isEditing = false;
            setImageReferences([...updated]);
        }
    };

    const handleNavigateHistory = (imageIndex: 0 | 1, direction: 'prev' | 'next') => {
        if (currentReferenceIndex === null) return;
        const updated = [...imageReferences];
        const histories = updated[currentReferenceIndex].histories;
        if (!histories) return;
        const history = histories[imageIndex];
        if (!history) return;
        const idx = history.order.indexOf(history.currentId);
        if (idx < 0) return;
        if (direction === 'prev' && idx > 0) {
            history.currentId = history.order[idx - 1];
        }
        if (direction === 'next' && idx < history.order.length - 1) {
            history.currentId = history.order[idx + 1];
        }
        setImageReferences(updated);
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

            {view === 'generation' && !allImagesSelected && currentReferenceIndex !== null && imageReferences.length > 0 && (
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
                            onEditInstruction={handleEditInstruction}
                            onNavigateHistory={handleNavigateHistory}
                            onImageError={(imageIndex) => {
                                const updated = [...imageReferences];
                                const cur = updated[currentReferenceIndex!];
                                const arr: [boolean, boolean] = cur.loadErrors ? [...cur.loadErrors] as [boolean, boolean] : [false, false];
                                arr[imageIndex] = true;
                                cur.loadErrors = arr;
                                setImageReferences(updated);
                            }}
                        />
                    </div>
                </section>
            )}
            {view === 'generation' && allImagesSelected && (
                <section className="results-section" style={{ marginTop: '1rem' }}>
                    <div className="results-navigation" style={{ justifyContent: 'space-between' }}>
                        <button className="nav-button" onClick={handleStartOver}>Start Over</button>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            {exporting && (<span>Building…</span>)}
                            {!exporting && zipUrl && (
                                <>
                                    <a className="nav-button" href={zipUrl} download={`bananamd-package.zip`}>Download ZIP</a>
                                    {zipAllUrl && (
                                        <a className="nav-button" href={zipAllUrl} download={`bananamd-all-images.zip`}>Download All Images</a>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                    {exportError && <p className="generation-error">{exportError}</p>}
                    {exportPreview && (
                        <div className="image-reference-item" style={{ marginTop: '1rem' }}>
                            <div className="item-header">
                                <span className="item-path">Updated Markdown Preview</span>
                            </div>
                            <pre style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }}><code>{exportPreview}</code></pre>
                        </div>
                    )}
                </section>
            )}
            
            <Modal isOpen={isModalOpen} onClose={closeModal} content={modalContent} />
            <Modal isOpen={isPromptModalOpen} onClose={closePromptModal} content={promptModalContent} title="Generation Prompt" />
        </div>
    );
};

# BananaMD Project Overview for Gemini

## Core Idea

BananaMD is a client-side web application designed to rapidly and effectively illustrate Markdown-based slides or documents using the Nano Banana image generation model. It allows users to generate new illustrations for image placeholders or update existing ones.

## Tech Stack

- **Frontend:** React with TypeScript
- **Bundler:** Vite
- **Libraries:**
    - `@google/genai`: For interacting with the Gemini API (including Nano Banana).
    - `jszip`: For handling `.zip` file uploads and packaging the final output.
- **Language:** All code and comments are in English.

## High-Level Workflow

1.  **File Upload:** The user uploads either a single `.md` file or a `.zip` archive containing a `.md` file and associated image folders.
2.  **Style Input (Optional):** The user can upload a style reference image and/or choose to maintain the style of the first selected image for all subsequent generations.
3.  **Processing:** The user clicks "Propose illustrative images" to start the process.
4.  **Image Generation & Selection:**
    - The application identifies all image placeholders (`![]()` and `<img src="...">`).
    - For each placeholder, it presents two generated image proposals side-by-side.
    - The user can iteratively refine any proposal through a chat-like interface. Each refinement creates a new version of the image, with a history (2/2, 3/3, etc.).
    - The user selects the definitive image for the current placeholder.
    - The application then moves to the next image placeholder in the document.
5.  **Final Output:** After an image has been selected for every placeholder, the user can download a `.zip` file. This archive contains:
    - The modified `.md` file, with updated image links and AI-generated alt text for accessibility.
    - An `images/` folder containing all the chosen images, named with descriptive slugs.
    - A separate zip with all generated images (used and discarded) can also be downloaded.

## Detailed Generation Logic

### Image Placeholder Detection

The application parses the Markdown content to find all occurrences of:
- Markdown syntax: `![]()`
- HTML syntax: `<img src="...">` (including variations with classes and styles).

It preserves the original syntax type when updating the file.

### GENERATE FROM TEXT (No existing image)

- **If `alt` text is present (`![alt text](...)`):** The `alt` text is used as the basis to create two distinct, high-quality prompts for Nano Banana.
- **If `alt` text is absent (`![]()`):**
    - Gemini (gemini-flash-2.5) analyzes the full document content and the specific context (500 chars before/after the placeholder) to propose two different image concepts.
    - These concepts are then turned into two high-quality prompts for Nano Banana.
- **Style Application:**
    - If a style reference image was provided, it's included in the generation request.
    - If "Try to maintain the style of the first image" is checked, the first *user-selected* image becomes the style reference for all subsequent generations.

### GENERATE FROM IMAGE (Existing image in `.zip` or URL)

- **Left Proposal:**
    - If a style reference is active, the original image is adapted to that style.
    - If not, a generic "improve this image" prompt is used.
- **Right Proposal:**
    - Gemini (gemini-flash-2.5) first generates a description of the existing image.
    - This description is then used to fuel the "GENERATE FROM TEXT" flow to create a new image from scratch.

## Technical Implementation Details

- **Client-Side Only:** The entire process runs in the user's browser. No server-side components are used for file processing or image generation logic.
- **API Keys:** The user's Gemini API key is managed client-side and stored in a `.env.local` file for local development.
- **Prompt Management:** All prompts sent to the Gemini API are constructed from templates stored in external `.txt` files (`context_to_description.txt`, `description_to_nano_prompt.txt`) for easier maintenance.
- **Error Handling & API Limits:**
    - **Rate Limits:** If the API key hits a rate limit, the user is notified and the process stops. They can download the work completed so far.
    - **Generation Failures:** The app retries a failed generation up to 5 times with a 1-second delay between attempts. If it still fails, the user is notified.
- **Processing Flow:** Image generation is handled sequentially, one placeholder at a time.
- **UX/UI:**
    - **Loading States:** Spinners indicate when images are being generated.
    - **Background Generation:** If the "maintain style" option is *not* used, the app pre-generates images for subsequent placeholders in the background to reduce waiting time. If the option *is* used, it waits for the first image selection to establish the style reference.
    - **Navigation:** The user must proceed through the images in order.
    - **State:** The process is ephemeral. Closing the browser tab will result in loss of work.
    - **Preview:** A preview of the final document is shown on the download screen.
- **Edge Cases:**
    - **Corrupt ZIPs:** The user is notified if the uploaded `.zip` file is invalid.
    - **Broken Links:** If an image URL is broken, it's treated as if there were no image, triggering the "GENERATE FROM TEXT" flow.
    - **Multiple `.md` files in ZIP:** The app will arbitrarily pick one to process.

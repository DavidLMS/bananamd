# Contributing to BananaMD

Thanks for your interest in improving BananaMD! This is a lightweight guide to help you get started quickly.

## Ways to contribute
- Report bugs and UX issues (screenshots + steps help a ton).
- Propose small features or polish (please describe the use‑case).
- Submit pull requests for focused fixes or improvements.

## Quick start (dev)
Prerequisites: Node.js ≥ 18 and a Gemini API key.

```bash
npm install
# Create your local env
cp .env.local .env.local.backup 2>/dev/null || true
# Edit .env.local and set:
# GEMINI_API_KEY=your_key_here
npm run dev
```

Open the app and test the basic flow:
- Upload a `.md` or a `.zip` with a `.md` inside.
- (Optional) Add a style reference image and/or check “maintain style of first image”.
- Click Generate, select proposals in order, and export the ZIP.

## Pull request checklist
- Keep changes small and focused (one thing per PR).
- No secrets or credentials in code or history.
- Test both inputs: single `.md` and `.zip` with images.
- Verify export: updated `.md`, `images/` folder, descriptive slugs, alt text.
- If you touch prompt templates (`*.txt`), keep them clear and concise.

## Code style
- TypeScript + React (client‑only).
- Keep UI strings in English.
- Keep prompt logic in the external `.txt` templates (do not inline long prompts in code).
- Preserve original Markdown/HTML syntax when rewriting (Markdown `![]()` vs `<img ...>`).

## Commit & branch
- Use short, descriptive commits in present tense (e.g., `fix: hide old context button while loading`).
- Create feature branches from `main` and open a PR when ready.

## Licensing
By contributing, you agree that your contributions will be licensed under the repository’s license (CC BY 4.0).

## Questions
Open an issue if something is unclear or you need guidance. Thanks again! 🍌

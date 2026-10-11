# Third-party notices

Mindmap AI directly uses the following production packages. Licenses were verified from the installed package metadata for the locked dependency tree.

| Component | License | Use |
| --- | --- | --- |
| Electron | MIT | Windows desktop runtime and sandboxed `WebContentsView` |
| React / React DOM | MIT | Renderer UI |
| simple-mind-map | MIT | Mind-map engine and interaction plugins |
| flexlayout-react | MIT | Docking and serialized panel layout |
| CodeMirror / @uiw/react-codemirror | MIT | Markdown editor |
| react-markdown, remark-gfm, remark-math, rehype-katex | MIT | Markdown/GFM/formula preview |
| KaTeX | MIT | Formula rendering |
| Turndown and turndown-plugin-gfm | MIT | HTML-to-Markdown conversion |
| Zod | MIT | Runtime schema validation |
| Zustand | MIT | Renderer state management |
| lucide-react | ISC | UI icons |
| write-file-atomic | ISC | Atomic file replacement |
| yaml | ISC | Answer front matter |
| @aws-sdk/client-s3 | Apache-2.0 | S3 and compatible object storage synchronization |

The production dependency tree also contains permissively licensed transitive packages under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, Zlib, and dual-license expressions that include MIT. The exact versions and resolved packages are recorded in `pnpm-lock.yaml`; run `pnpm licenses list --prod` against that lockfile for the complete machine-readable inventory.

Copyright and license texts remain with their respective upstream authors. This notice does not replace any notice shipped inside an upstream package.

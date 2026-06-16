import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useT } from "../i18n";

/** Render assistant/user text as GitHub-flavored Markdown. Links open externally (Electron
 *  denies in-page nav → shell.openExternal); raw HTML is not rendered; images aren't fetched. */
export function MarkdownBody({ text }: { text: string }): JSX.Element {
  const t = useT();
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="md-img">
              [{t("img.alt")}
              {alt ? `: ${alt}` : ""}]
            </span>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

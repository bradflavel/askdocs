import type { Root } from "mdast";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { Plugin } from "unified";

const CITATION_RE = /\[chunk:(\d+)\]/g;

/**
 * Remark plugin that rewrites [chunk:N] tokens in text nodes into link
 * MDAST nodes with href `#chunk-N` — but only when N is in the provided
 * allowed set. Tokens whose ids fall outside the set stay as plain text,
 * preserving the model's verbatim output.
 *
 * The link form keeps us inside react-markdown's standard component
 * mapping; intercept it via `components.a` and check for the `#chunk-`
 * href prefix to render the pill component instead of an anchor.
 *
 * mdast-util-find-and-replace skips code and inlineCode nodes by
 * default, so a [chunk:42] inside a code fence stays as code.
 */
export function remarkCitations(allowed: Set<number>): Plugin<[], Root> {
  return () => (tree) => {
    findAndReplace(tree, [
      CITATION_RE,
      (_match: string, id: string) => {
        const n = Number(id);
        if (!allowed.has(n)) return false;
        return {
          type: "link",
          url: `#chunk-${id}`,
          children: [{ type: "text", value: `[${id}]` }],
        };
      },
    ]);
  };
}

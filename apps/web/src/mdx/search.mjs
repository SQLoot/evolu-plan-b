import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import { slugifyWithCounter } from "@sindresorhus/slugify";
import glob from "fast-glob";
import { toString } from "mdast-util-to-string";
import { remark } from "remark";
import remarkMdx from "remark-mdx";
import { createLoader } from "simple-functional-loader";
import { filter } from "unist-util-filter";
import { SKIP, visit } from "unist-util-visit";
import { addSyntheticH1 } from "./searchUtils.mjs";

const __filename = url.fileURLToPath(import.meta.url);
const searchIndexPath = path.resolve(
  path.dirname(__filename),
  "./searchIndex.js",
);
const processor = remark().use(remarkMdx).use(extractSections);
const slugify = slugifyWithCounter();

function isObjectExpression(node) {
  return (
    node.type === "mdxTextExpression" &&
    node.data?.estree?.body?.[0]?.expression?.type === "ObjectExpression"
  );
}

function excludeObjectExpressions(tree) {
  return filter(tree, (node) => !isObjectExpression(node));
}

function extractSections() {
  return (tree, { sections }) => {
    slugify.reset();

    visit(tree, (node) => {
      if (node.type === "heading" && node.depth <= 2) {
        const content = toString(excludeObjectExpressions(node));
        const hash = node.depth === 1 ? null : slugify(content);
        sections.push([content, hash, []]);
        return SKIP;
      }
      // Extract text from paragraphs, table cells, list items, etc.
      if (
        node.type === "paragraph" ||
        node.type === "tableCell" ||
        node.type === "listItem"
      ) {
        const content = toString(excludeObjectExpressions(node));
        sections.at(-1)?.[2].push(content);
        return SKIP;
      }
    });
  };
}

export default function Search(nextConfig = {}) {
  const cache = new Map();

  return Object.assign({}, nextConfig, {
    webpack(config, options) {
      config.module.rules.push({
        test: __filename,
        use: [
          createLoader(function () {
            const appDir = path.resolve("./src/app");
            this.addContextDependency(appDir);

            const files = glob.sync("**/*.mdx", { cwd: appDir });
            const data = files.map((file) => {
              let url = `/${file.replace(/(^|\/)page\.mdx$/, "")}`;
              url = url.replace("(docs)/", "");
              url = url.replace("(landing)/", "");
              const mdx = fs.readFileSync(path.join(appDir, file), "utf8");

              let sections = [];

              if (cache.get(file)?.[0] === mdx) {
                sections = cache.get(file)[1];
              } else {
                try {
                  const vfile = { value: mdx, sections };
                  processor.runSync(processor.parse(vfile), vfile);

                  addSyntheticH1(sections, mdx);

                  cache.set(file, [mdx, sections]);
                } catch (err) {
                  console.error(`\n\n❌ MDX PARSE ERROR in file: ${file}\n`);
                  console.log(JSON.stringify(err));
                  console.error("\n");
                  throw err;
                }
              }

              return { url, sections };
            });

            // Read the search index template and inject the data
            const template = fs.readFileSync(searchIndexPath, "utf8");
            return template.replace(
              'const data = "DATA_PLACEHOLDER";',
              `const data = ${JSON.stringify(data)};`,
            );
          }),
        ],
      });

      if (typeof nextConfig.webpack === "function") {
        return nextConfig.webpack(config, options);
      }

      return config;
    },
  });
}

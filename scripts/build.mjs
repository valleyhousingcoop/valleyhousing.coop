import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "README.md");
const templatePath = path.join(root, "template.html");
const outputPath = path.join(root, "index.html");
const bodyPlaceholder = "{{BODY}}";

marked.setOptions({ gfm: true });

const [markdown, template] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(templatePath, "utf8"),
]);
const body = marked.parse(markdown);
const parts = template.split(bodyPlaceholder);

if (parts.length !== 2) {
  throw new Error(`Expected template.html to contain exactly one ${bodyPlaceholder} placeholder.`);
}

const html = parts.join(indent(body.trim(), 4));

await writeFile(outputPath, html);

function indent(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

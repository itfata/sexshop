import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const productsFile = path.resolve(directory, "../../products.js");
const outputFile = path.resolve(directory, "../src/catalog.generated.js");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(productsFile, "utf8"), context, { filename: productsFile });

const products = context.window.PRODUCTS;
if (!Array.isArray(products) || !products.length) throw new Error("products.js does not contain a product catalog");

const entries = products.map((product) => {
  if (!product.slug || !product.name || !Number.isFinite(product.price) || product.price <= 0) {
    throw new Error(`Invalid product: ${JSON.stringify(product)}`);
  }
  return `  ${JSON.stringify(product.slug)}: ${JSON.stringify({ name: product.name, price: product.price })}`;
});

const output = `// Generated from products.js by npm run sync-catalog. Do not edit manually.\nexport const catalog = Object.freeze({\n${entries.join(",\n")}\n});\n`;
fs.writeFileSync(outputFile, output);
console.log(`Synced ${products.length} products to ${path.relative(process.cwd(), outputFile)}`);

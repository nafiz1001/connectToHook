import fs from "fs"
import * as parser from "@babel/parser";
import traverse_ from "@babel/traverse";
import { CallExpression, Identifier } from "@babel/types";
const traverse = (traverse_ as any).default as typeof traverse_;

const filePaths = process.argv.slice(2)
const content = fs.readFileSync(filePaths[0])
const ast = parser.parse(content.toString(), { sourceType: "module", plugins: ["jsx"] });


let usesConnect = false
traverse(ast, {
    ExportDefaultDeclaration(nodePath) {
        const node = nodePath.node
        const afterDefault = node.declaration as CallExpression

        const connectCall = afterDefault.callee as CallExpression
        const connectName = (connectCall.callee as Identifier).name
        const connectArguments = connectCall.arguments as Identifier[]

        const component = afterDefault.arguments[0] as Identifier

        console.log(`export default ${connectName}(${connectArguments.map((arg) => arg.name).join(", ")})(${component.name});`);
    }
});
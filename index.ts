const acorn = require("acorn")
const AcornJSX = require("acorn-jsx")
const AcornClassFields = require("acorn-class-fields")
const walk = require("acorn-walk")
const fs = require("fs")

const JSXParser = acorn.Parser.extend(
    AcornJSX(),
    AcornClassFields,
)

const filePaths = process.argv.slice(2)

const content = fs.readFileSync(filePaths[0])
const node = JSXParser.parse(content.toString(), { ecmaVersion: "latest", sourceType: "module" })
walk.simple(node, {
    ExportDefaultDeclaration(node: any) {
        console.log(node);
    }
}, {
    ...walk.base,
    JSXElement: () => { },
})

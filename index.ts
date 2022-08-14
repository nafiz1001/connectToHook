import fs from "fs"
import * as parser from "@babel/parser";
import traverse_, { NodePath, Scope } from "@babel/traverse";
import { CallExpression, Identifier, Node, ExportDefaultDeclaration } from "@babel/types";
const traverse = (traverse_ as any).default as typeof traverse_;


const findNode = <T = Node>(ast: Node, target: Node["type"], condition: (path: NodePath<T>) => boolean, scope?: Scope | undefined, state?: T | undefined, parentPath?: NodePath | undefined) => {
    let path: NodePath<T> | undefined;

    traverse(
        ast,
        {
            [target](_path: NodePath<T>) {
                if (condition(_path)) {
                    path = _path
                    _path.stop()
                }
            }
        },
        scope,
        state,
        parentPath,
    )

    if (!path) {
        throw `${target} not found within lines ${ast.start}-${ast.end}`
    }

    return { path, node: path.node, rest: [path.scope, path.state, path.parentPath] }
}

const findConnect = (ast: Node) => {
    const {
        node: exportDefaultDeclaration,
        rest: exportDefaultDeclarationRest
    } = findNode<ExportDefaultDeclaration>(ast, "ExportDefaultDeclaration", () => true)

    const connect = findNode<CallExpression>(exportDefaultDeclaration, "CallExpression", (path) => {
        return (path.node.callee as Identifier)?.name === "connect"
    }, ...exportDefaultDeclarationRest).node

    const rightBeforeConnect = findNode<CallExpression>(exportDefaultDeclaration, "CallExpression", (path) => {
        return path.node.callee === connect
    }, ...exportDefaultDeclarationRest).node

    const defaultComponent = (rightBeforeConnect.arguments[0] as Identifier)?.name

    if (connect.arguments.length > 2) {
        throw `${connect.arguments.length} > 2`
    }

    const [mapStateToPropsNode, actionCreatorsNode] = connect.arguments as Identifier[]

    return {
        rightBeforeConnect,
        defaultComponent,
        mapStateToProps: mapStateToPropsNode?.name,
        actionCreators: actionCreatorsNode?.name,
    }
}

const parseFile = (filePath: string) => {
    const content = fs.readFileSync(filePath)
    const ast = parser.parse(content.toString(), { sourceType: "module", plugins: ["jsx"] });

    const { rightBeforeConnect, defaultComponent, mapStateToProps, actionCreators } = findConnect(ast)

    console.log(`connect(${mapStateToProps}, ${actionCreators})(${defaultComponent})`);
}

const filePaths = process.argv.slice(2)
parseFile(filePaths[0])
import fs from "fs"
import * as parser from "@babel/parser";
import traverse_, { NodePath, Scope } from "@babel/traverse";
import { CallExpression, Identifier, Node, ExportDefaultDeclaration, VariableDeclaration, ArrowFunctionExpression, ObjectExpression, ObjectProperty, MemberExpression } from "@babel/types";
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
    const exportDefaultDeclaration = findNode<ExportDefaultDeclaration>(ast, "ExportDefaultDeclaration", () => true)

    const connect = findNode<CallExpression>(exportDefaultDeclaration.node, "CallExpression", (path) => {
        return (path.node.callee as Identifier)?.name === "connect"
    }, ...exportDefaultDeclaration.rest).node

    const rightBeforeConnect = findNode<CallExpression>(exportDefaultDeclaration.node, "CallExpression", (path) => {
        return path.node.callee === connect
    }, ...exportDefaultDeclaration.rest).node

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
    const content = fs.readFileSync(filePath).toString()
    const ast = parser.parse(content, { sourceType: "module", plugins: ["jsx"] });

    const { rightBeforeConnect, defaultComponent, mapStateToProps, actionCreators } = findConnect(ast)

    const mapStateToPropsDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === mapStateToProps
    })

    const propsToState = (((mapStateToPropsDeclaration.node.declarations[0].init as ArrowFunctionExpression).body as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
        const key = (prop.key as Identifier).name
        const valueExpression = (prop.value as MemberExpression)
        const value = content.substring(valueExpression.start as number, valueExpression.end as number)

        return [key, value]
    })

    propsToState.forEach(([k, v]) => {
        console.log(`const ${k} = useSelector((state) => ${v})`);
    })

    const actionCreatorsDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === actionCreators
    })

    const actions = ((actionCreatorsDeclaration.node.declarations[0].init as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
        const key = (prop.key as Identifier).name
        return key
    })

    actions.forEach((name) => {
        console.log(`dispatch(${name}())`);
    })
}

const filePaths = process.argv.slice(2)
parseFile(filePaths[0])
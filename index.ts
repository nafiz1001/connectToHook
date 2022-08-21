import fs from "fs"
import * as parser from "@babel/parser";
import traverse_, { NodePath, Scope } from "@babel/traverse";
import { CallExpression, Identifier, Node, ExportDefaultDeclaration, VariableDeclaration, ArrowFunctionExpression, ObjectExpression, ObjectProperty, MemberExpression, ObjectPattern, BlockStatement } from "@babel/types";
const traverse = (traverse_ as any).default as typeof traverse_;


const findNode = <T = Node>(ast: Node, target: Node["type"], condition: (path: NodePath<T>) => boolean = () => true, scope?: Scope | undefined, state?: T | undefined, parentPath?: NodePath | undefined) => {
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
    const exportDefaultDeclaration = findNode<ExportDefaultDeclaration>(ast, "ExportDefaultDeclaration")

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

    const actionCreatorsDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === actionCreators
    })

    const actions = ((actionCreatorsDeclaration.node.declarations[0].init as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
        const key = (prop.key as Identifier).name
        return key
    })

    const defaultComponentDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === defaultComponent
    })

    const defaultComponentFunction = defaultComponentDeclaration.node.declarations[0].init as ArrowFunctionExpression
    const defaultComponentParams = defaultComponentFunction.params[0] as ObjectPattern
    const defaultComponentBody = defaultComponentFunction.body as BlockStatement

    const skipLines = [mapStateToPropsDeclaration.node, actionCreatorsDeclaration.node].map((node) => {
	return [node.start, node.end] as number[]
    }).sort((a, b) => a[0] - b[0])

    // console.log(content.substring(0, skipLines[0][0]))
    // console.log(content.substring(skipLines[0][1], skipLines[1][0]))
    // console.log(content.substring(skipLines[1][1], defaultComponentParams.start as number - 1))
    console.log(`const ${defaultComponent} = (${[...actions, ...propsToState.map(([k, _]) => k)].reduce((prev, curr) => {
	return prev.replace(RegExp(`[ \n]*${curr},?[ \n]*`), "")
    }, content.substring(defaultComponentParams.start as number, defaultComponentParams.end as number))}) => {`)

    const baseIndentation = " ".repeat(defaultComponentBody.body[0].loc?.start.column as number)

    propsToState.forEach(([k, v]) => {
        console.log(`${baseIndentation}const ${k} = useSelector((state) => ${v})`);
    })

    console.log(`${baseIndentation}const dispatch = useDispatch()`)

    actions.forEach((name) => {
        console.log(`${baseIndentation}const dispatch${name[0].toUpperCase()}${name.substring(1)} = useCallback((...args) => dispatch(${name}(..args)), [dispatch])`);
    })

    console.log()

    console.log(`${baseIndentation}${actions.reduce((prev, curr) => {
	return prev.replace(curr, `dispatch${curr[0].toUpperCase()}${curr.substring(1)}`)
    }, content.substring(defaultComponentBody.body[0].start as number, defaultComponentBody.end as number))}`)

    console.log(content.substring(defaultComponentBody.end as number))
}

const filePaths = process.argv.slice(2)
parseFile(filePaths[0])

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

    return path ? { path, node: path.node, rest: [path.scope, path.state, path.parentPath] } : undefined
}

const throwUndefined = <T>(o: T | undefined) => {
    if (o) {
        return o
    } else {
        throw new Error("undefined error")
    }
}

const findConnect = (ast: Node) => {
    const exportDefaultDeclaration = throwUndefined(findNode<ExportDefaultDeclaration>(ast, "ExportDefaultDeclaration"))

    const connect = throwUndefined(findNode<CallExpression>(exportDefaultDeclaration.node, "CallExpression", (path) => {
        return (path.node.callee as Identifier)?.name === "connect"
    }, ...exportDefaultDeclaration.rest)).node

    const rightBeforeConnect = throwUndefined(findNode<CallExpression>(exportDefaultDeclaration.node, "CallExpression", (path) => {
        return path.node.callee === connect
    }, ...exportDefaultDeclaration.rest)).node

    const defaultComponent = (rightBeforeConnect.arguments[0] as Identifier)?.name

    if (connect.arguments.length > 2) {
        throw `${connect.arguments.length} > 2`
    }

    const [mapStateToPropsNode, actionCreatorsNode] = connect.arguments as (Identifier | undefined)[]

    return {
        rightBeforeConnect,
        defaultComponent,
        mapStateToPropsName: mapStateToPropsNode?.name,
        actionCreatorsName: actionCreatorsNode?.name,
    }
}

const parseFile = (filePath: string) => {
    const content = fs.readFileSync(filePath).toString()
    const ast = parser.parse(content, { sourceType: "module", plugins: ["jsx"] });

    const { rightBeforeConnect, defaultComponent, mapStateToPropsName, actionCreatorsName } = findConnect(ast)

    const mapStateToPropsDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === mapStateToPropsName
    })

    // key value pairs in mapStateProps
    const propsToState = mapStateToPropsDeclaration ? (((mapStateToPropsDeclaration.node.declarations[0].init as ArrowFunctionExpression).body as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
        const key = (prop.key as Identifier).name
        const valueExpression = (prop.value as MemberExpression)
        const value = content.substring(valueExpression.start as number, valueExpression.end as number)

        return [key, value]
    }) : []

    const actionCreatorsDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === actionCreatorsName
    })

    // all the actions from redux
    const actions = actionCreatorsDeclaration ? ((actionCreatorsDeclaration.node.declarations[0].init as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
        const key = (prop.key as Identifier).name
        return key
    }) : []

    const defaultComponentDeclaration = throwUndefined(findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === defaultComponent
    }))

    console.log('import { useDispatch, useSelector } from "react-redux";')

    const defaultComponentFunction = defaultComponentDeclaration.node.declarations[0].init as ArrowFunctionExpression
    const defaultComponentParams = defaultComponentFunction.params[0] as ObjectPattern
    const defaultComponentBody = defaultComponentFunction.body as BlockStatement

    // regions of lines to skip including mapStateProps and actionCreators
    // I don't know which is first, so I sort
    const skipLines = [mapStateToPropsDeclaration?.node, actionCreatorsDeclaration?.node].filter((x) => x !== undefined).map((x) => x as VariableDeclaration).map((node) => {
	return [node.start, node.end] as number[]
    }).sort((a, b) => a[0] - b[0])

    // print every from top to the default component except mapStateProps and actionCreators
    if (skipLines.length == 2) {
        console.log(content.substring(0, skipLines[0][0]))
        console.log(content.substring(skipLines[0][1], skipLines[1][0]))
        console.log(content.substring(skipLines[1][1], defaultComponentDeclaration.node.start as number - 1))
    } else if (skipLines.length == 1) {
        console.log(content.substring(0, skipLines[0][0]))
        console.log(content.substring(skipLines[0][1], defaultComponentDeclaration.node.start as number - 1))
    }

    // print default component signature
    console.log(`const ${defaultComponent} = (${[...actions, ...propsToState.map(([k, _]) => k)].reduce((prev, curr) => {
	return prev.replace(RegExp(`[ \n]*${curr},?[ \n]*`), "")
    }, content.substring(defaultComponentParams.start as number, defaultComponentParams.end as number))}) => {`)

    // indentation to use for the function body
    const baseIndentation = " ".repeat(defaultComponentBody.body[0].loc?.start.column as number)

    // print selectors
    propsToState.forEach(([k, v]) => {
        console.log(`${baseIndentation}const ${k} = useSelector((state) => ${v})`);
    })

    // print dispatchers
    console.log(`${baseIndentation}const dispatch = useDispatch()`)
    actions.forEach((name) => {
        console.log(`${baseIndentation}const dispatch${name[0].toUpperCase()}${name.substring(1)} = useCallback((...args) => dispatch(${name}(..args)), [dispatch])`);
    })

    // print the rest of the body while replacing each actions with a dispatched version

    console.log()

    console.log(`${baseIndentation}${actions.reduce((prev, curr) => {
	return prev.replace(curr, `dispatch${curr[0].toUpperCase()}${curr.substring(1)}`)
    }, content.substring(defaultComponentBody.body[0].start as number, defaultComponentBody.end as number))}`)

    // print everything after the default component declaration with connect remove
    console.log(`${content.substring(defaultComponentBody.end as number, rightBeforeConnect.start as number)}${defaultComponent}${content.substring(rightBeforeConnect.end as number)}`)
}

const filePaths = process.argv.slice(2)
parseFile(filePaths[0])

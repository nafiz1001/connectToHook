import fs from "fs/promises"
import * as parser from "@babel/parser";
import traverse_, { NodePath, Scope } from "@babel/traverse";
import { CallExpression, Identifier, Node, ExportDefaultDeclaration, VariableDeclaration, ArrowFunctionExpression, ObjectExpression, ObjectProperty, MemberExpression, ObjectPattern, BlockStatement, FunctionDeclaration } from "@babel/types";
const traverse = (traverse_ as any).default as typeof traverse_;

const parse = (content: string) => parser.parse(content, { sourceType: "module", plugins: ["jsx"] })

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


const findFunction = (ast: Node, name: string) => {
    const variableDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === name
    })

    if (variableDeclaration) {
        const arrowFunction = variableDeclaration.node.declarations[0].init as ArrowFunctionExpression | undefined
        return arrowFunction && { declaration: variableDeclaration, params: arrowFunction.params, body: arrowFunction.body }
    } else {
        const functionDeclaration = findNode<FunctionDeclaration>(ast, "VariableDeclaration", (path) => {
            return (path.node.id as Identifier)?.name === name
        })
        return functionDeclaration && { declaration: functionDeclaration, params: functionDeclaration?.node.params, body: functionDeclaration.node.body }
    }
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

    const defaultComponentName = (rightBeforeConnect.arguments[0] as Identifier)?.name

    if (connect.arguments.length > 2) {
        throw `${connect.arguments.length} > 2`
    }

    const [mapStateToPropsNode, actionCreatorsNode] = connect.arguments as (Identifier | undefined)[]

    return {
        rightBeforeConnect,
        defaultComponentName,
        mapStateToPropsName: mapStateToPropsNode?.name,
        actionCreatorsName: actionCreatorsNode?.name,
    }
}

const findMapStateProps = (content: string, ast: Node, mapStateToPropsName: string) => {
    const mapStateToPropsFunction = findFunction(ast, mapStateToPropsName)
    const propsToState = mapStateToPropsFunction ? ((mapStateToPropsFunction.body as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
        const key = (prop.key as Identifier).name
        const valueExpression = (prop.value as MemberExpression)
        const value = content.substring(valueExpression.start as number, valueExpression.end as number)

        return [key, value]
    }) : []

    return {
        node: mapStateToPropsFunction,
        propsToState,
    }
}

const parseObjectProperties = (content: string, expr: ObjectExpression | ObjectPattern) => {
    return (expr.properties as ObjectProperty[]).map((prop) => {
        return [
            content.substring(prop.key.start as number, prop.key.end as number),
            content.substring(prop.value.start as number, prop.value.end as number),
        ]
    })
}

const findActionCreators = (content: string, ast: Node, actionCreatorsName: string) => {
    const actionCreatorsDeclaration = findNode<VariableDeclaration>(ast, "VariableDeclaration", (path) => {
        return (path.node.declarations[0].id as Identifier)?.name === actionCreatorsName
    })
    const actions = actionCreatorsDeclaration
        ? parseObjectProperties(content, actionCreatorsDeclaration.node.declarations[0].init as ObjectExpression).map(([k, _]) => k)
        : []

    return {
        node: actionCreatorsDeclaration,
        actions,
    }
}

const findDefaultComponent = (content: string, ast: Node, defaultComponentName: string) => {
    const defaultComponentFunction = findFunction(ast, defaultComponentName)
    if (defaultComponentFunction) {
        const defaultComponentDeclaration = defaultComponentFunction.declaration
        const defaultComponentParams = defaultComponentFunction.params[0] as ObjectPattern
        const defaultComponentBody = defaultComponentFunction.body as BlockStatement

        return {
            defaultComponentDeclaration,
            defaultComponentParams,
            defaultComponentBody,
        }
    }
}

const replaceNodeContent = (content: string, node: Node, replacement: string) => {
    const newContent = content.substring(0, node.start as number) + replacement + content.substring(node.end as number)

    return {
        ast: parse(newContent),
        content: newContent
    }
}

const parseContent = (content: string) => {
    const ast = parser.parse(content, { sourceType: "module", plugins: ["jsx"] });
    const result = []

    const { rightBeforeConnect, defaultComponentName, mapStateToPropsName, actionCreatorsName } = findConnect(ast)

    const mapStateToPropsFunction = mapStateToPropsName !== undefined ? findFunction(ast, mapStateToPropsName) : undefined

    // key value pairs in mapStateProps
    const propsToState = mapStateToPropsFunction ? ((mapStateToPropsFunction.body as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
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

    const defaultComponentFunction = throwUndefined(findFunction(ast, defaultComponentName))

    result.push('import { useDispatch, useSelector } from "react-redux";')

    const defaultComponentDeclaration = defaultComponentFunction.declaration
    const defaultComponentParams = defaultComponentFunction.params[0] as ObjectPattern
    const defaultComponentBody = defaultComponentFunction.body as BlockStatement

    // regions of lines to skip including mapStateProps and actionCreators
    // I don't know which is first, so I sort
    const skipLines = [mapStateToPropsFunction?.declaration.node, actionCreatorsDeclaration?.node].filter((x) => x).map((x) => x as VariableDeclaration).map((node) => {
        return [node.start, node.end] as number[]
    }).sort((a, b) => a[0] - b[0])

    // print every from top to the default component except mapStateProps and actionCreators
    if (skipLines.length == 2) {
        result.push(content.substring(0, skipLines[0][0]))
        result.push(content.substring(skipLines[0][1], skipLines[1][0]))
        result.push(content.substring(skipLines[1][1], defaultComponentDeclaration.node.start as number - 1))
    } else if (skipLines.length == 1) {
        result.push(content.substring(0, skipLines[0][0]))
        result.push(content.substring(skipLines[0][1], defaultComponentDeclaration.node.start as number - 1))
    }

    // print default component signature
    result.push(`const ${defaultComponentName} = (${[...actions, ...propsToState.map(([k, _]) => k)].reduce((prev, curr) => {
        return prev.replace(RegExp(`[ \n]*${curr},?[ \n]*`), "")
    }, content.substring(defaultComponentParams.start as number, defaultComponentParams.end as number))}) => {`)

    // indentation to use for the function body
    const baseIndentation = " ".repeat(defaultComponentBody.body[0].loc?.start.column as number)

    // print selectors
    propsToState.forEach(([k, v]) => {
        result.push(`${baseIndentation}const ${k} = useSelector((state) => ${v})`);
    })

    // print dispatchers
    result.push(`${baseIndentation}const dispatch = useDispatch()`)
    actions.forEach((name) => {
        result.push(`${baseIndentation}const dispatch${name[0].toUpperCase()}${name.substring(1)} = useCallback((...args) => dispatch(${name}(...args)), [dispatch])`);
    })

    // print the rest of the body while replacing each actions with a dispatched version

    result.push("")

    result.push(`${baseIndentation}${actions.reduce((prev, curr) => {
        return prev.replace(curr, `dispatch${curr[0].toUpperCase()}${curr.substring(1)}`)
    }, content.substring(defaultComponentBody.body[0].start as number, defaultComponentBody.end as number))}`)

    // print everything after the default component declaration with connect remove
    result.push(`${content.substring(defaultComponentBody.end as number, rightBeforeConnect.start as number)}${defaultComponentName}${content.substring(rightBeforeConnect.end as number)}`)

    return result.join("\n")
}

const filePaths = process.argv.slice(2)

const errors: { filePath: string, error: string }[] = []

const results = filePaths.map(async (filePath) => {
    const buffer = await fs.readFile(filePath)
    try {
        const result = parseContent(buffer.toString())
        await fs.writeFile(filePath, result)
    } catch (e) {
        errors.push({ filePath, error: (e as Error).stack ?? "Unknown error" })
        throw e
    }
})

Promise.allSettled(results).then(() => {
    console.log(`${filePaths.length - errors.length}/${filePaths.length} Processed Successfully`)
    errors.forEach(({ filePath, error }) => {
        console.log(`${filePath}: ${error}`)
    })
})


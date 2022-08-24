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

const findNodes = <T = Node>(ast: Node, target: Node["type"], condition: (path: NodePath<T>) => boolean = () => true, scope?: Scope | undefined, state?: T | undefined, parentPath?: NodePath | undefined) => {
    let paths: NodePath<T>[] = [];

    traverse(
        ast,
        {
            [target](_path: NodePath<T>) {
                if (condition(_path)) {
                    paths.push(_path)
                    _path.stop()
                }
            }
        },
        scope,
        state,
        parentPath,
    )

    return paths.map((path) => ({ path, node: path.node, rest: [path.scope, path.state, path.parentPath] }))
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
    const propsToState = mapStateToPropsFunction ? Object.fromEntries(((mapStateToPropsFunction.body as ObjectExpression).properties as ObjectProperty[]).map((prop) => {
        const key = (prop.key as Identifier).name
        const valueExpression = (prop.value as MemberExpression)
        const value = content.substring(valueExpression.start as number, valueExpression.end as number)

        return [key, value]
    })) : {}

    return {
        node: mapStateToPropsFunction?.declaration.node,
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
        node: actionCreatorsDeclaration?.node,
        actions,
    }
}

const actionReplacement = (action: string) => {
    const wrapper = `dispatch${action[0].toUpperCase()}${action.substring(1)}`
    return [wrapper, `const ${wrapper} = useCallback((...args) => ${action}(...args), [dispatch])`]
}

const findDefaultComponent = (content: string, ast: Node, defaultComponentName: string) => {
    const defaultComponentFunction = findFunction(ast, defaultComponentName)

    if (!defaultComponentFunction) {
        throw new Error(`defaultComponentFunction is ${defaultComponentFunction}`)
    }

    const defaultComponentDeclaration = defaultComponentFunction.declaration
    const defaultComponentParams = defaultComponentFunction.params[0] as ObjectPattern
    const defaultComponentBody = defaultComponentFunction.body

    return {
        defaultComponentDeclaration,
        defaultComponentParams,
        defaultComponentBody,
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
    let ast = parser.parse(content, { sourceType: "module", plugins: ["jsx"] });
    let propsToState: { [_: string]: string } = {};
    let actions: string[] = []

    const {
        rightBeforeConnect,
        defaultComponentName,
        mapStateToPropsName,
        actionCreatorsName,
    } = findConnect(ast);

    ({ ast, content } = replaceNodeContent(content, rightBeforeConnect, defaultComponentName));

    if (mapStateToPropsName) {
        let mapStateToPropsDeclaration: Node | undefined;
        ({ node: mapStateToPropsDeclaration, propsToState } = findMapStateProps(content, ast, mapStateToPropsName));

        if (mapStateToPropsDeclaration) {
            ({ ast, content } = replaceNodeContent(content, mapStateToPropsDeclaration, ""));
        }
    }

    if (actionCreatorsName) {
        let actionCreatorsDeclaration: Node | undefined;
        ({ node: actionCreatorsDeclaration, actions } = findActionCreators(content, ast, actionCreatorsName));

        if (actionCreatorsDeclaration) {
            ({ ast, content } = replaceNodeContent(content, actionCreatorsDeclaration, ""));
        }
    }

    const {
        defaultComponentParams,
        defaultComponentBody,
    } = findDefaultComponent(content, ast, defaultComponentName);

    const paramReplacement = `{ ${(defaultComponentParams.properties as ObjectProperty[]).map((prop) => {
        return { key: (prop.key as Identifier).name, value: prop.value }
    }).filter(({ key }) => {
        return !actions.find((action) => action === key)
    }).map(({ value }) => value).join(", ")} }`;

    ({ ast, content } = replaceNodeContent(content, defaultComponentParams, paramReplacement));

    let newBody = actions.reduce((content, action) => {
        return content.replace(action, actionReplacement(action)[0])
    }, content.substring(defaultComponentBody.start as number, defaultComponentBody.end as number));
    ast = parse(content.substring(0, defaultComponentBody.start as number) + newBody + content.substring(defaultComponentBody.end as number));
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


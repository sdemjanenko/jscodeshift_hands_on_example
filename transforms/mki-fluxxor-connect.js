import _ from "underscore";

const findRequirePathAndBinding = (j, root, moduleName) => {
  let result = null;
  const requireCall = root.find(j.VariableDeclarator, {
    id: {type: 'Identifier'},
    init: {
      callee: {name: 'require'},
      arguments: [{value: moduleName}],
    },
  });

  const importStatement = root.find(j.ImportDeclaration, {
    source: {
      value: moduleName,
    },
  });

  if (importStatement.size()) {
    importStatement.forEach(path => {
      result = {
        path,
        binding: path.value.specifiers[0].local.name,
        type: 'import',
      };
    });
  } else if (requireCall.size()) {
    requireCall.forEach(path => {
      result = {
        path,
        binding: path.value.id.name,
        type: 'require',
      };
    });
  }

  return result;
};


function hasFluxxor(j, root) {
  const importStatement = root.find(j.ImportDeclaration, {
    source: {
      value: "fluxxor",
    },
  });
  return importStatement.size() > 0;
}

function hasReactCreateClass(j, root) {
  const ReactUtils = require("./utils/ReactUtils")(j);
  const components = ReactUtils.findReactCreateClass(root);
  return components.length > 0;
}

function findParentVariableDeclaration(j, path) {
  let parentPath = path;
  while (parentPath && parentPath.value) {
    if (parentPath.value.type === "VariableDeclaration") {
      return parentPath;
    }
    parentPath = parentPath.parentPath;
  }
  return false;
}

function findParentVariableDeclarator(j, path) {
  let parentPath = path;
  while (parentPath && parentPath.value) {
    if (parentPath.value.type === "VariableDeclarator") {
      return parentPath;
    }
    parentPath = parentPath.parentPath;
  }
  return false;
}

function findVariableUsesForPath(j, path, scope) {
  if (path.parentPath.value.type === "VariableDeclarator") {
    const variableName = path.parentPath.value.id.name;
    const paths = []; // we need to return an array, not a Collection
    // NOTE: im not sure why `closestScope` only returns the path and not the true scope
    (scope || j(path).closestScope()).find(j.Identifier, {name: variableName}).filter((nodePath) => {
      // return variable uses which are on the left side of a MemberExpression
      return nodePath.parentPath.value.type === "MemberExpression" && nodePath.parentPath.value.object === nodePath.value;
    }).forEach((nodePath) => {
      paths.push(nodePath);
    });
    return paths;
  }
  return [];
}

function findUsesAndVariableUsesForPath(j, path) {
  // check if the MemberExpression is assigned to a variable. If so, find all the uses of that variable
  if (path.parentPath.value.type === "VariableDeclarator") {
    return findVariableUsesForPath(j, path);
  } else {
    return path;
  }
}

function removePathIfStoredInVariable(j, path) {
  if (path.parentPath.value.type === "VariableDeclarator") {
    j(path.parentPath).remove();
  }
}

function findGetFluxPathsInPath(j, path) {
  return j(path).find(j.MemberExpression, {
    object: {type: "ThisExpression"},
    property: {type: "Identifier", name: "getFlux"},
  }).map((nodePath) => { // return the CallExpression
    return nodePath.parentPath;
  });
}

// finds `this.getFlux().stores` as well as any uses of a variable
// into which it is referenced.
function findFluxStorePathsInPath(j, path) {
  return findGetFluxPathsInPath(j, path).filter((nodePath) => {
    return nodePath.parentPath.value.type === "MemberExpression" && nodePath.parentPath.value.property.name === "store";
  })
  .map((nodePath) => nodePath.parentPath); // returns the MemberExpression with `.actions` as the property
}

// finds `this.getFlux().actions` as well as any uses of a variable
// into which it is referenced.
function findFluxActionPathsInPath(j, path) {
  return findGetFluxPathsInPath(j, path).filter((nodePath) => {
    return nodePath.parentPath.value.type === "MemberExpression" && nodePath.parentPath.value.property.name === "actions";
  })
  .map((nodePath) => nodePath.parentPath); // returns the MemberExpression with `.actions` as the property
}

function findPathAndPropertiesForDeepMemberExpression(j, innerPath) {
  let parentPath = innerPath.parentPath;
  if (!parentPath || parentPath.value.type !== "MemberExpression") {
    return null;
  }

  const properties = [];
  let outermostActionPath;
  while (parentPath) {
    if (parentPath.value.type === "MemberExpression") {
      properties.push(parentPath.value.property.name);
      outermostActionPath = parentPath;
    } else {
      if (!outermostActionPath) {
        return null;
      } else {
        return {properties, path: outermostActionPath};
      }
    }
    parentPath = parentPath.parentPath;
  }
}

function getComponentName(j, componentPath) {
  const componentVariableDeclarator = findParentVariableDeclarator(j, componentPath);
  if (componentVariableDeclarator) {
    return componentVariableDeclarator.value.id.name;
  }
  return "";
}

function checkRefactoredComponent(j, componentPath) {
  // check for `getFlux` references
  const getFluxCount = j(parentPath).find(j.MemberExpression, {
    object: {type: "ThisExpression"},
    property: {type: "Identifier", name: "getFlux"},
  }).length;

  if (getFluxCount === 0) {
    fluxMixins.forEach((fluxMixin) => {
      if (fluxMixin.parentPath && fluxMixin.parentPath.value && fluxMixin.parentPath.value.type === "CallExpression") {
        j(fluxMixin.parentPath).remove();
      } else {
        try {
          j(fluxMixin).remove();
        } catch(_) {
        }
      }
    });

    storeWatchMixins.forEach((storeWatchMixin) => {
      try {
        j(storeWatchMixin).remove();
      } catch(_) {
      }
    });

    const node = parentPath.value;
    if (node.callee.type === "MemberExpression" && node.callee.object.name === "React" && node.callee.property.name === "createClass") {
      const classOptions = node.arguments[0];
      if (classOptions.type === "ObjectExpression") {
        classOptions.properties.forEach((property) => {
          if (property.key.name === "mixins" && property.value.type === "ArrayExpression") {
            //console.log("property", property, property.value.elements[0])
            if (property.value.elements.length === 0) {
              j(property).remove();
            }
          }
        });
      }
    }
  }
}

function createMapStoresToPropsFunction(j, componentName, {accessedStores, getStateFromFluxBody}) {
  if (_.isEmpty(accessedStores)) {
    return {
      accessedStores: accessedStores || [],
    };
  }

  const params = [
    j.arrayPattern(accessedStores.map(store => j.identifier(`passed${store}`))),
    j.identifier("ownProps"),
  ];
  const mapStoresToPropsName = j.identifier(`mapStoresTo${componentName}Props`);
  const mapStoresToProps = getStateFromFluxBody ? j.functionDeclaration(mapStoresToPropsName, params, getStateFromFluxBody) : undefined;

  return {
    accessedStores,
    mapStoresToPropsName,
    mapStoresToProps,
  }
}

function refactorThisPropsToOwnProps(j, path) {
  j(path).find(j.MemberExpression, {
    object: {type: "ThisExpression"},
    property: {type: "Identifier", name: "props"},
  }).replaceWith((instance) => {
    return j.identifier("ownProps");
  });
}

function processGetStateFromFlux(j, componentPath) {
  // refactor getStateFromFlux and determine that state it is injecting
  let res;

  j(componentPath).find(j.ObjectMethod, {
    key: { name: "getStateFromFlux" },
  }).forEach((nodePath) => {
    // const stores = mixinCall.value.arguments.map((arg) => arg.value);

    const getStateFromFluxBody = nodePath.value.body;
    refactorThisPropsToOwnProps(j, getStateFromFluxBody);

    // get rid of any variable uses holding `this.getFlux()`
    findGetFluxPathsInPath(j, getStateFromFluxBody)
      .map((fluxPath) => findVariableUsesForPath(j, fluxPath, j(getStateFromFluxBody))).forEach((fluxPath) => {
        j(fluxPath).replaceWith(() => {
          return j.callExpression(j.memberExpression(j.thisExpression(), j.identifier("getFlux")), []);
        });
      });
    findGetFluxPathsInPath(j, getStateFromFluxBody).forEach((fluxPath) => removePathIfStoredInVariable(j, fluxPath));

    // get rid of any variable uses holding `this.getFlux().store`
    findFluxStorePathsInPath(j, getStateFromFluxBody)
      .map((fluxStorePath) => findVariableUsesForPath(j, fluxStorePath, j(getStateFromFluxBody))).forEach((fluxStorePath) => {
        j(fluxStorePath).replaceWith(() => {
          return j.memberExpression(j.callExpression(j.memberExpression(j.thisExpression(), j.identifier("getFlux")), []), j.identifier("store"));
        });
      });
    findFluxStorePathsInPath(j, getStateFromFluxBody).forEach((fluxStorePath) => removePathIfStoredInVariable(j, fluxStorePath));

    const accessedStores = [];
    findFluxStorePathsInPath(j, getStateFromFluxBody)
      .map((fluxStorePath) => fluxStorePath.parentPath)
      .filter((fluxStoreParentPath) => fluxStoreParentPath.value.type === "CallExpression")
      .forEach((fluxStoreCallPath) => {
        const calledStores = fluxStoreCallPath.value.arguments.map((arg) => arg.value);
        if (calledStores.length !== 1) {
          console.error("Expected this.getFlux().store to be called with one argument");
        }
        if (accessedStores.indexOf(calledStores[0]) === -1) {
          accessedStores.push(calledStores[0]);
        }
        j(fluxStoreCallPath).replaceWith(j.identifier(`passed${calledStores[0]}`));
        // TODO: we might want to error if the store isn't in StoreWatchMixin
      });

    // find injected state
    j(getStateFromFluxBody).find(j.ReturnStatement, {
      argument: {type: "ObjectExpression"},
    }).forEach((returnPath) => {
      returnPath.value.argument.properties.forEach((property) => {
        if (property.key.type === "Identifier") {
          j(componentPath).find(j.MemberExpression, {
            object: {
              type: "MemberExpression",
              object: {
                type: "ThisExpression",
              },
              property: {
                type: "Identifier",
                name: "state",
              },
            },
            property: {
              type: "Identifier",
              name: property.key.name,
            },
          }).forEach((stateInstance) => {
            j(stateInstance).find(j.Identifier, {name: "state"}).replaceWith((stateIdentifier) => {
              return j.identifier("props");
            });
          });
        }
      });
    });

    // remove `getStateFromFlux`
    j(componentPath).find(j.ObjectMethod, {
      key: { name: "getStateFromFlux" },
    }).remove();

    res = { // TODO: Make this less hacky
      accessedStores,
      getStateFromFluxBody,
    };
  });

  return res || {};
}

function processComponentStores(j, componentPath) {
  const options = processGetStateFromFlux(j, componentPath);
  return createMapStoresToPropsFunction(j, getComponentName(j, componentPath), options);
}

function createMapActionsToPropsFunction(j, componentName, actions) {
  if (!_.isEmpty(actions)) {
    const mapActionsName = `mapActionsTo${componentName}Props`

    const params = [
      j.identifier("actions"),
      // j.identifier("ownProps"),
    ];

    const usedActionKeys = [];
    const actionProperties = actions.map((actionPath) => {
      const actionKey = `actions.${actionPath.join(".")}`;
      if (!_.contains(usedActionKeys, actionKey)) {
        usedActionKeys.push(actionKey);
        return j.property("init", j.literal(actionKey), j.identifier(actionKey));
      }
    });

    const actionBody = j.blockStatement([
      j.returnStatement(j.objectExpression(_.compact(actionProperties))),
    ]);

    const mapActionsToPropsName = j.identifier(mapActionsName);
    const mapActionsToProps = j.functionDeclaration(mapActionsToPropsName, params, actionBody);

    return {
      mapActionsToProps,
      mapActionsToPropsName,
    };
  } else {
    return {};
  }
}

function processComponentActions(j, componentPath) {
  const actions = [];
  findFluxActionPathsInPath(j, componentPath)
    .map((nodePath) => findUsesAndVariableUsesForPath(j, nodePath))
    .forEach((getFluxActionPath) => {
      const res = findPathAndPropertiesForDeepMemberExpression(j, getFluxActionPath);
      if (res && res.path) {
        j(res.path).replaceWith(j.memberExpression(
          j.memberExpression(
            j.thisExpression(),
            j.identifier("props")
          ),
          j.literal(`actions.${res.properties.join(".")}`)
        ))
        actions.push(res.properties);
      }
    });
  // NOTE: we might want to look for flux.actions since sometimes our developers don't use `this.getFlux()`

  findFluxActionPathsInPath(j, componentPath).forEach((nodePath) => {
    if (nodePath.parentPath.value.type === "VariableDeclarator") {
      j(nodePath.parentPath).remove();
    } else {
      j(nodePath).remove();
    }
  });

  return createMapActionsToPropsFunction(j, getComponentName(j, componentPath), actions);
}

function removePathOrParentIfParentIsCallExpression(j, path) {
  if (path.parentPath.value.type === "CallExpression") {
    j(path.parentPath).remove();
  } else {
    j(path).remove();
  }
}

function removeFluxMixinsForPath(j, path) {
  const ReactUtils = require("./utils/ReactUtils")(j);
  const fluxxor = findRequirePathAndBinding(j, path, "fluxxor");
  const fluxxorBinding = fluxxor.binding;

  // remove Fluxxor.FluxMixin and Fluxxor.StoreWatchMixin
  path.find(j.MemberExpression, {
    object: { name: fluxxorBinding },
  }).forEach((fluxxorPath) => {
    if (fluxxorPath.parentPath.value.type === "VariableDeclarator") {
      // its being saved into a variable
      const variablePath = fluxxorPath.parentPath;
      j(variablePath).closestScope().find(j.Identifier, {
        name: variablePath.value.id.name,
      }).forEach((variableUsagePath) => {
        removePathOrParentIfParentIsCallExpression(j, variableUsagePath);
      });
      j(variablePath).remove();
    } else if (fluxxorPath.parentPath.value.type === "CallExpression" && fluxxorPath.parentPath.parentPath.value.type === "VariableDeclarator") {
      const variablePath = fluxxorPath.parentPath.parentPath;
      j(variablePath).closestScope().find(j.Identifier, {
        name: variablePath.value.id.name,
      }).forEach((variableUsagePath) => {
        j(variableUsagePath).remove();
      });
      j(variablePath).remove();
    } else {
      removePathOrParentIfParentIsCallExpression(j, fluxxorPath);
    }
  });

  // remove empty mixins
  const componentPaths = ReactUtils.findReactCreateClass(path);
  componentPaths.forEach((componentPath) => {
    j(componentPath).find(j.ObjectProperty, {
      key: {type: "Identifier", name: "mixins"},
    }).forEach((mixinPath) => {
      if (mixinPath.value.value.elements.length === 0) {
        j(mixinPath).remove();
      }
    });
  });
}

function updateComponentReferences(j, componentPath, componentName) {
  j(componentPath).closestScope().find(j.Identifier, {
    name: componentName,
  }).filter((instance) => {
    let parentPath = instance.parentPath;
    while (parentPath) {
      if (parentPath.value.type === "VariableDeclarator") {
        const id = parentPath.value.id;
        if (id && id === instance.value) {
          return false;
        } else if (id && id.type === "Identifier" && id.name === `Connected${componentName}`) {
          return false;
        }
      } else if (parentPath.value.type === "MemberExpression") {
        return false;
      }
      parentPath = parentPath.parentPath;
    }
    return true;
  }).replaceWith((instance) => {
    return j.identifier(`Connected${componentName}`);
  });
}

function wrapComponentInMkiFluxxorConnect(j, componentPath, {stores, actions}) {
  if (!stores.mapStoresToProps && !actions.mapActionsToProps) {
    return false;
  }

  const storeArg = j.arrayExpression((stores.accessedStores || []).map(store => j.literal(store)));

  const connectCallArguments = [
    storeArg,
    stores.mapStoresToPropsName || j.literal(null), // TODO: handle case where we don't have one
  ]

  if (actions.mapActionsToPropsName) {
    connectCallArguments.push(actions.mapActionsToPropsName);
  }

  const connectCall = j.callExpression(j.identifier("mkiFluxxorConnect"), connectCallArguments);
  const componentName = getComponentName(j, componentPath);

  j(componentPath).closest(j.VariableDeclaration).forEach((nodePath) => {
    j(nodePath).insertAfter(j.variableDeclaration("const", [
      j.variableDeclarator(
        j.identifier(`Connected${componentName}`),
        j.callExpression(connectCall, [j.identifier(componentName)])
      ),
    ]));

    if (actions.mapActionsToProps) {
      j(nodePath).insertAfter(actions.mapActionsToProps);
    }

    if (stores.mapStoresToProps) {
      j(nodePath).insertAfter(stores.mapStoresToProps);
    }
  });

  updateComponentReferences(j, componentPath, componentName);

  return true;
}

function processComponent(j, componentPath) {
  const actions = processComponentActions(j, componentPath);
  const stores = processComponentStores(j, componentPath);

  return wrapComponentInMkiFluxxorConnect(j, componentPath, {
    actions,
    stores,
  });

  return changed;
}

function cleanupImportsAndMixins(j, root) {
  const fluxxor = findRequirePathAndBinding(j, root, "fluxxor");
  const mkiFluxxorConnect = findRequirePathAndBinding(j, root, "lib/MkiFluxxorWrapper");
  // TODO: it might exist and we need to add the binding
  if (!mkiFluxxorConnect) {
    j(fluxxor.path).insertAfter(j.template.statement([
      `import { mkiFluxxorConnect } from "lib/MkiFluxxorWrapper";`
    ]));
  }

  removeFluxMixinsForPath(j, root);

  // cleanup mixins

  j(fluxxor.path).remove();
}


function refactorFile(j, root) {
  const ReactUtils = require("./utils/ReactUtils")(j);
  const componentPaths = ReactUtils.findReactCreateClass(root);

  const componentStoresAndActions = [];
  let changed = false;
  componentPaths.forEach((componentPath) => {
    changed = processComponent(j, componentPath) || changed;
  });

  if (changed) {
    cleanupImportsAndMixins(j, root);
  }
  // TODO: handle case where the component is exported inline.

  // run sanity check

  return changed;
}

module.exports = function(file, api) {
  const j = api.jscodeshift.withParser("babylon");
  const root = j(file.source);
  let hasModifications = false;

  if (hasFluxxor(j, root) && hasReactCreateClass(j, root)) {
    hasModifications = refactorFile(j, root);
  }

  if (!hasModifications) {
    return null;
  }

  return root.toSource({
    quote: "double",
    tabWidth: 2,
    reuseWhitespace: true,
    trailingComma: true,
  });
}


function process(j, root) {
  // TODO: Rename the variable `foo` to `bar`

  root.find(j.Identifier, {
    name: "foo",
  }).forEach((nodePath) => {
    j(nodePath).replaceWith(j.identifier("bar"));
  });

  // HELPFUL LINKS:
  //
  // https://github.com/facebook/jscodeshift/wiki/jscodeshift-Documentation
  // - look at `scope`, `findVariableDeclarators` and `renameTo` to make this even better
  //
  // https://astexplorer.net/
}

module.exports = function(file, api) {
  const j = api.jscodeshift.withParser("babylon");
  const root = j(file.source);
  process(j, root);

  return root.toSource({
    quote: "double",
    tabWidth: 2,
    reuseWhitespace: true,
    trailingComma: true,
  });
}


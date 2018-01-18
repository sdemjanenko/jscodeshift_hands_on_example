const foo = "value";

function one(arg1) {
  return foo + arg1;
}

function two(arg1) {
  return foo + arg1.foo;
}

function three(arg1) {
  return `${foo}${arg1}`;
}

function four(arg1) {
  const foo = "other value";
  return `${foo}${arg1}`;
}

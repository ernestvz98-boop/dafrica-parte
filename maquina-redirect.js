"use strict";
const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const target = new URL("./", location.href);
target.searchParams.set("mod", "maquinaria");
if (token) target.searchParams.set("token", token);
location.replace(target.toString());

"use strict";
const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const tag = params.get("tag") || "";
const target = new URL("./", location.href);
target.searchParams.set("mod", "maquinaria");
if (token) target.searchParams.set("token", token);
if (tag) target.searchParams.set("tag", tag);
location.replace(target.toString());

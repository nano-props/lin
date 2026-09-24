plugins {
    base
}

tasks.named("build") {
    dependsOn(":server:build")
}

tasks.register("buildWeb") {
    dependsOn(":web:buildWeb")
}

tasks.register("test") {
    dependsOn(":server:test")
}

tasks.register("nativeCompile") {
    dependsOn(":server:nativeCompile")
}

tasks.register("run") {
    dependsOn(":server:run")
}

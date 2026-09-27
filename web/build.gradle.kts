plugins {
    base
}

val buildWeb = tasks.register<Exec>("buildWeb") {
    description = "Build the xterm frontend with Bun"
    commandLine("bash", rootProject.file("scripts/build-web.sh").absolutePath)
    inputs.dir("src")
    inputs.dir("public")
    inputs.files("package.json", "bun.lock", "index.html", "tsconfig.json", "vite.config.ts")
    inputs.file(rootProject.file("scripts/build-web.sh"))
    outputs.dir(layout.projectDirectory.dir("dist"))
}

tasks.named("build") {
    dependsOn(buildWeb)
}

plugins {
    base
}

val buildWeb = tasks.register<Exec>("buildWeb") {
    description = "Build the xterm frontend with Bun"
    commandLine("bash", rootProject.file("scripts/build-web.sh").absolutePath)
    inputs.dir(layout.projectDirectory.dir("src"))
    inputs.dir(layout.projectDirectory.dir("public"))
    inputs.files(
        layout.projectDirectory.file("package.json"),
        layout.projectDirectory.file("bun.lock"),
        layout.projectDirectory.file("index.html"),
        layout.projectDirectory.file("tsconfig.json"),
        layout.projectDirectory.file("vite.config.ts"),
    )
    outputs.dir(layout.projectDirectory.dir("dist"))
}

tasks.named("build") {
    dependsOn(buildWeb)
}

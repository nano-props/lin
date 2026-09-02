import org.gradle.jvm.toolchain.JavaLanguageVersion

plugins {
    application
    java
    id("org.graalvm.buildtools.native") version "1.1.9"
}

group = "nano.lin"
version = "0.1.0"

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

application {
    mainClass = "nano.lin.Main"
    applicationDefaultJvmArgs = listOf("--enable-native-access=ALL-UNNAMED")
}

val frontendDir = layout.projectDirectory.dir("frontend")
val nativeLibrary = layout.buildDirectory.file("native/liblinpty.so")
val nativeLibraryPath = nativeLibrary.get().asFile.absolutePath

val buildWeb = tasks.register<Exec>("buildWeb") {
    description = "Build the xterm frontend with Bun"
    commandLine("bash", "scripts/build-web.sh")
    inputs.dir(frontendDir.dir("src"))
    inputs.dir(frontendDir.dir("public"))
    inputs.files(
        frontendDir.file("package.json"),
        frontendDir.file("bun.lock"),
        frontendDir.file("index.html"),
        frontendDir.file("tsconfig.json"),
        frontendDir.file("vite.config.ts"),
    )
    outputs.dir(frontendDir.dir("dist"))
}

val buildPtyShim = tasks.register<Exec>("buildPtyShim") {
    description = "Build the embedded Linux PTY shim"
    commandLine("bash", "scripts/build-pty-shim.sh")
    inputs.file("src/main/c/linpty.c")
    outputs.file(nativeLibrary)
}

tasks.processResources {
    dependsOn(buildWeb, buildPtyShim)
    from(frontendDir.dir("dist")) {
        into("web")
    }
    from(nativeLibrary) {
        into("native/linux-x86_64")
    }
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = application.mainClass.get()
    }
}

tasks.named<JavaExec>("run") {
    dependsOn(buildPtyShim)
    jvmArgs("--enable-native-access=ALL-UNNAMED")
    systemProperty("lin.native.library", nativeLibraryPath)
}

graalvmNative {
    toolchainDetection.set(true)
    binaries {
        named("main") {
            imageName.set("lin")
            mainClass.set(application.mainClass)
            buildArgs.addAll(
                "--no-fallback",
                "--enable-native-access=ALL-UNNAMED",
            )
        }
    }
}

tasks.matching { it.name == "nativeCompile" }.configureEach {
    dependsOn(buildWeb, buildPtyShim)
}

tasks.test {
    useJUnitPlatform()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:6.0.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

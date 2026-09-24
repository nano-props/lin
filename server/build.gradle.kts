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

val hostOs = System.getProperty("os.name").lowercase()
val hostArch = System.getProperty("os.arch").lowercase()
val isMacOsArm64 = hostOs.contains("mac") && (hostArch == "aarch64" || hostArch == "arm64")
val isLinuxX64 = hostOs.contains("linux") && (hostArch == "amd64" || hostArch == "x86_64")

if (!isMacOsArm64 && !isLinuxX64) {
    throw GradleException("Unsupported host: ${System.getProperty("os.name")} ${System.getProperty("os.arch")}; supported targets are Linux x86_64 and macOS arm64")
}

val nativeLibraryName = if (isMacOsArm64) "liblinpty.dylib" else "liblinpty.so"
val nativeResourceDirectory = if (isMacOsArm64) "native/macos-aarch64" else "native/linux-x86_64"
val nativeLibrary = layout.buildDirectory.file("native/$nativeLibraryName")
val nativeLibraryPath = nativeLibrary.get().asFile.absolutePath
val webProject = project(":web")

val buildPtyShim = tasks.register<Exec>("buildPtyShim") {
    description = "Build the native PTY shim"
    commandLine("bash", rootProject.file("scripts/build-pty-shim.sh").absolutePath)
    environment("LIN_NATIVE_OUTPUT_DIR", nativeLibrary.get().asFile.parentFile.absolutePath)
    inputs.file("src/main/c/linpty.c")
    outputs.file(nativeLibrary)
}

tasks.processResources {
    dependsOn(":web:buildWeb", buildPtyShim)
    from(webProject.layout.projectDirectory.dir("dist")) {
        into("web")
    }
    from(nativeLibrary) {
        into(nativeResourceDirectory)
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
    dependsOn(":web:buildWeb", buildPtyShim)
}

tasks.test {
    useJUnitPlatform()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:6.0.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

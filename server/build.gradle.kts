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

val ptyResources = layout.buildDirectory.dir("generated/pty-resources")

val buildPtyShim = tasks.register<Exec>("buildPtyShim") {
    description = "Build and stage the native PTY resources"
    commandLine("bash", rootProject.file("scripts/build-pty-shim.sh"), ptyResources.get().asFile)
    inputs.files("src/main/c/linpty.c", rootProject.file("scripts/build-pty-shim.sh"))
    inputs.property("os", System.getProperty("os.name"))
    inputs.property("arch", System.getProperty("os.arch"))
    inputs.property("compiler", providers.environmentVariable("CC").orElse(""))
    outputs.dir(ptyResources)
}

tasks.processResources {
    dependsOn(":web:buildWeb", buildPtyShim)
    from(project(":web").layout.projectDirectory.dir("dist")) { into("web") }
    from(ptyResources)
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = application.mainClass.get()
    }
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

tasks.test {
    useJUnitPlatform()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:6.0.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

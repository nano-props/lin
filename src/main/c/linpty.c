#define _GNU_SOURCE

#include <errno.h>
#include <pty.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

int lin_pty_spawn(
    const char *cwd,
    char *const argv[],
    char *const envp[],
    int cols,
    int rows,
    int *master_fd,
    int *child_pid
) {
    struct winsize size = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };

    int fd = -1;
    pid_t pid = forkpty(&fd, NULL, NULL, &size);
    if (pid < 0) {
        return errno;
    }

    if (pid == 0) {
        if (chdir(cwd) != 0) {
            static const char message[] = "lin: cannot enter the home directory\r\n";
            ssize_t ignored = write(STDERR_FILENO, message, sizeof(message) - 1);
            (void)ignored;
            _exit(126);
        }
        execve(argv[0], argv, envp);
        static const char message[] = "lin: cannot start the login shell\r\n";
        ssize_t ignored = write(STDERR_FILENO, message, sizeof(message) - 1);
        (void)ignored;
        _exit(127);
    }

    *master_fd = fd;
    *child_pid = (int)pid;
    return 0;
}

int lin_pty_resize(int fd, int cols, int rows) {
    struct winsize size = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };
    return ioctl(fd, TIOCSWINSZ, &size) == 0 ? 0 : errno;
}

long long lin_pty_read(int fd, void *buffer, int length) {
    ssize_t count = read(fd, buffer, (size_t)length);
    return count >= 0 ? (long long)count : -(long long)errno;
}

long long lin_pty_write(int fd, const void *buffer, int length) {
    ssize_t count = write(fd, buffer, (size_t)length);
    return count >= 0 ? (long long)count : -(long long)errno;
}

int lin_pty_signal(int pid, int signal_number) {
    if (kill(-pid, signal_number) == 0 || errno == ESRCH) {
        return 0;
    }
    return kill(pid, signal_number) == 0 || errno == ESRCH ? 0 : errno;
}

int lin_pty_wait(int pid, int *status) {
    pid_t result;
    do {
        result = waitpid((pid_t)pid, status, 0);
    } while (result < 0 && errno == EINTR);
    return result >= 0 ? 0 : errno;
}

int lin_pty_close(int fd) {
    return close(fd) == 0 || errno == EBADF ? 0 : errno;
}

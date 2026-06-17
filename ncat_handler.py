#!/usr/bin/env python3

import argparse
import itertools
import socket
import threading
import time

from dataclasses import dataclass, field
from typing import Dict

from prompt_toolkit import PromptSession, print_formatted_text
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.patch_stdout import patch_stdout
from prompt_toolkit.styles import Style


style = Style.from_dict({
    "banner": "bold #00d7ff",
    "ok": "#00ff87",
    "warn": "#ffd75f",
    "err": "#ff5f5f",
    "cmd": "bold #af87ff",
    "muted": "#808080",
    "remote": "#5fd7ff",
})


def html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
    )


def print_html(text: str):
    print_formatted_text(HTML(text), style=style)


@dataclass
class ClientSession:
    sid: int
    conn: socket.socket
    addr: tuple
    created: float = field(default_factory=time.time)
    alive: bool = True
    lock: threading.Lock = field(default_factory=threading.Lock)

    def send(self, data: str):
        with self.lock:
            self.conn.sendall(data.encode(errors="ignore"))

    def recv(self, size=4096) -> bytes:
        return self.conn.recv(size)

    def close(self):
        self.alive = False

        try:
            self.conn.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass

        try:
            self.conn.close()
        except Exception:
            pass


class NcatHandler:

    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port

        self.sessions: Dict[int, ClientSession] = {}

        self.sid_counter = itertools.count(1)

        self.running = True

        self.sessions_lock = threading.Lock()

    def start_listener(self):

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

        server.bind((self.host, self.port))

        server.listen(128)

        server.settimeout(1.0)

        print_html(
            f"<ok>[+] Listening on {self.host}:{self.port}</ok>"
        )

        while self.running:

            try:
                conn, addr = server.accept()

                conn.settimeout(0.25)

                sid = next(self.sid_counter)

                client = ClientSession(
                    sid=sid,
                    conn=conn,
                    addr=addr,
                )

                with self.sessions_lock:
                    self.sessions[sid] = client

                print_html(
                    f"<ok>[+] New session {sid}</ok> "
                    f"from "
                    f"<cmd>{addr[0]}:{addr[1]}</cmd>"
                )

            except socket.timeout:
                continue

            except OSError:
                break

            except Exception as e:
                print_html(
                    f"<err>[!] Listener error: "
                    f"{html_escape(str(e))}</err>"
                )

        try:
            server.close()
        except Exception:
            pass

    def list_sessions(self):

        with self.sessions_lock:
            items = list(self.sessions.items())

        if not items:
            print_html("<warn>No sessions.</warn>")
            return

        print()

        header = (
            f"{'ID':<5}"
            f"{'Remote Address':<24}"
            f"{'Age':<10}"
            f"{'Status':<10}"
        )

        separator = (
            f"{'-' * 4:<5}"
            f"{'-' * 22:<24}"
            f"{'-' * 8:<10}"
            f"{'-' * 8:<10}"
        )

        print_html(f"<banner>{header}</banner>")

        print_html(f"<muted>{separator}</muted>")

        for sid, s in items:

            age = f"{int(time.time() - s.created)}s"

            status = "alive" if s.alive else "dead"

            status_color = "ok" if s.alive else "err"

            remote = f"{s.addr[0]}:{s.addr[1]}"

            line = (
                f"{sid:<5}"
                f"{remote:<24}"
                f"{age:<10}"
            )

            print_formatted_text(
                HTML(
                    f"{line}"
                    f"<{status_color}>{status}</{status_color}>"
                ),
                style=style,
            )

        print()

    def remove_dead(self):

        with self.sessions_lock:

            dead = [
                sid
                for sid, s in self.sessions.items()
                if not s.alive
            ]

            for sid in dead:
                self.sessions.pop(sid, None)

        print_html(
            f"<ok>[+] Removed {len(dead)} dead session(s)</ok>"
        )

    def kill_session(self, sid: int):

        with self.sessions_lock:
            s = self.sessions.pop(sid, None)

        if not s:
            print_html("<err>No such session.</err>")
            return

        s.close()

        print_html(
            f"<ok>[+] Killed session {sid}</ok>"
        )

    def interact(self, sid: int):

        with self.sessions_lock:
            s = self.sessions.get(sid)

        if not s or not s.alive:
            print_html("<err>No such live session.</err>")
            return

        session = PromptSession(
            completer=WordCompleter(
                [
                    ":detach",
                    ":kill",
                ],
                ignore_case=True,
            )
        )

        reader_stop = threading.Event()

        print_html(
            f"<ok>[+] Interacting with session {sid}</ok> "
            f"<muted>({s.addr[0]}:{s.addr[1]})</muted>"
        )

        print_html(
            "<muted>"
            "Type :detach to return, :kill to close session."
            "</muted>"
        )

        def reader():

            buffer = b""

            while not reader_stop.is_set() and s.alive:

                try:
                    data = s.recv(4096)

                    if not data:
                        s.alive = False
                        break

                    buffer += data

                    while b"\n" in buffer:

                        raw_line, buffer = buffer.split(b"\n", 1)

                        text = (
                            raw_line
                            .decode(errors="replace")
                            .rstrip("\r")
                        )

                        print_formatted_text(
                            HTML(
                                f"<remote>"
                                f"[session-{sid}]"
                                f"</remote> "
                                f"{html_escape(text)}"
                            ),
                            style=style,
                        )

                except socket.timeout:
                    continue

                except OSError:
                    s.alive = False
                    break

                except Exception:
                    s.alive = False
                    break

            if buffer:

                text = (
                    buffer
                    .decode(errors="replace")
                    .rstrip("\r")
                )

                print_formatted_text(
                    HTML(
                        f"<remote>"
                        f"[session-{sid}]"
                        f"</remote> "
                        f"{html_escape(text)}"
                    ),
                    style=style,
                )

        reader_thread = threading.Thread(
            target=reader,
            daemon=True,
        )

        reader_thread.start()

        try:

            with patch_stdout():

                while s.alive:

                    try:

                        line = session.prompt(
                            HTML(
                                f"<cmd>session-{sid}</cmd> > "
                            ),
                            style=style,
                        )

                        stripped = line.strip()

                        if stripped == ":detach":
                            break

                        if stripped == ":kill":
                            self.kill_session(sid)
                            break

                        s.send(line + "\n")

                    except KeyboardInterrupt:
                        print_html(
                            "<warn>"
                            "Use :detach to leave this session."
                            "</warn>"
                        )

                    except EOFError:
                        break

                    except Exception as e:

                        print_html(
                            f"<err>"
                            f"[!] Interaction error: "
                            f"{html_escape(str(e))}"
                            f"</err>"
                        )

                        break

        finally:

            reader_stop.set()

            print_html(
                f"<warn>"
                f"[-] Detached from session {sid}"
                f"</warn>"
            )

    def console(self):

        command_completer = WordCompleter(
            [
                "sessions",
                "ls",
                "interact",
                "i",
                "kill",
                "prune",
                "help",
                "exit",
                "quit",
            ],
            ignore_case=True,
        )

        session = PromptSession(
            completer=command_completer
        )

        print_html(
            "<banner>"
            "Ncat Multi-Session Handler"
            "</banner>"
        )

        print_html(
            "<muted>"
            "Commands: sessions, interact ID, kill ID, "
            "prune, help, exit"
            "</muted>"
        )

        while self.running:

            try:

                cmd = session.prompt(
                    HTML("<cmd>handler</cmd> > "),
                    style=style,
                ).strip()

                if not cmd:
                    continue

                parts = cmd.split()

                base = parts[0].lower()

                if base in ("sessions", "ls"):

                    self.list_sessions()

                elif base in ("interact", "i"):

                    if (
                        len(parts) != 2
                        or not parts[1].isdigit()
                    ):

                        print_html(
                            "<err>"
                            "Usage: interact ID"
                            "</err>"
                        )

                    else:

                        self.interact(
                            int(parts[1])
                        )

                elif base == "kill":

                    if (
                        len(parts) != 2
                        or not parts[1].isdigit()
                    ):

                        print_html(
                            "<err>"
                            "Usage: kill ID"
                            "</err>"
                        )

                    else:

                        self.kill_session(
                            int(parts[1])
                        )

                elif base == "prune":

                    self.remove_dead()

                elif base == "help":

                    print_html("""

<banner>Commands</banner>

<cmd>sessions</cmd> / <cmd>ls</cmd>
    List sessions

<cmd>interact ID</cmd> / <cmd>i ID</cmd>
    Interact with session

<cmd>kill ID</cmd>
    Kill session

<cmd>prune</cmd>
    Remove dead sessions

<cmd>help</cmd>
    Show help

<cmd>exit</cmd> / <cmd>quit</cmd>
    Exit handler


<banner>Inside Session</banner>

<cmd>:detach</cmd>
    Return to handler

<cmd>:kill</cmd>
    Kill current session

""")

                elif base in ("exit", "quit"):

                    self.running = False

                    break

                else:

                    print_html(
                        "<err>"
                        "Unknown command. Type help."
                        "</err>"
                    )

            except KeyboardInterrupt:

                print_html(
                    "<warn>"
                    "Use exit to quit."
                    "</warn>"
                )

            except EOFError:
                break

        print_html(
            "<warn>Shutting down...</warn>"
        )

        with self.sessions_lock:

            sessions = list(
                self.sessions.values()
            )

            self.sessions.clear()

        for s in sessions:
            s.close()


def parse_args():

    parser = argparse.ArgumentParser(
        description=(
            "Professional multi-session "
            "ncat-style TCP handler"
        )
    )

    parser.add_argument(
        "-l",
        "--listen",
        default="0.0.0.0",
        help=(
            "Listen address "
            "(default: 0.0.0.0)"
        ),
    )

    parser.add_argument(
        "-p",
        "--port",
        type=int,
        required=True,
        help="Listen port",
    )

    return parser.parse_args()


def main():

    args = parse_args()

    handler = NcatHandler(
        args.listen,
        args.port,
    )

    listener_thread = threading.Thread(
        target=handler.start_listener,
        daemon=True,
    )

    listener_thread.start()

    handler.console()


if __name__ == "__main__":
    main()

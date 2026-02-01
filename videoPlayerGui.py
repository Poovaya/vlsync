import customtkinter as ctk
from tkinter import filedialog, messagebox
import vlc
import platform

import queue
import paho.mqtt.client as mqtt

BROKER = "vlsync.drish-shel.com"
PORT = 443
TOPIC = "vlsync/test"

msg_queue = queue.Queue()


class VideoPlayerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("VLSync")
        self.root.geometry("900x550")

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("dark-blue")

        self.is_playing = False
        self.is_fullscreen = False

        # ---- VLC ----
        self.instance = vlc.Instance("--no-video-title-show", "--no-fullscreen")
        self.player = self.instance.media_player_new()

        # ---- Video Frame ----
        self.video_frame = ctk.CTkFrame(root, fg_color="black")
        self.video_frame.pack(fill="both", expand=True)

        self.video_frame.bind("<Double-Button-1>", self.toggle_fullscreen)

        # ---- Controls ----
        self.controls = ctk.CTkFrame(root)
        self.controls.pack(pady=6)

        self.open_btn = ctk.CTkButton(
            self.controls, text="Open", width=80, command=self.open_file
        )
        self.open_btn.grid(row=0, column=0, padx=4)

        self.play_btn = ctk.CTkButton(
            self.controls, text="Play", width=80, command=self.toggle_play
        )
        self.play_btn.grid(row=0, column=1, padx=4)

        ctk.CTkButton(
            self.controls,
            text="-30s",
            width=80,
            command=lambda: self.seek_relative(-30),
        ).grid(row=0, column=2, padx=4)

        ctk.CTkButton(
            self.controls, text="+30s", width=80, command=lambda: self.seek_relative(30)
        ).grid(row=0, column=3, padx=4)

        self.fullscreen_btn = ctk.CTkButton(
            self.controls, text="Fullscreen", width=110, command=self.toggle_fullscreen
        )
        self.fullscreen_btn.grid(row=0, column=4, padx=4)

        ctk.CTkLabel(self.controls, text="Jump to:").grid(row=1, column=0, pady=4)

        self.jump_entry = ctk.CTkEntry(self.controls, width=100)
        self.jump_entry.grid(row=1, column=1)

        ctk.CTkButton(
            self.controls, text="Go", width=80, command=self.jump_to_time
        ).grid(row=1, column=2)

        # ---- Key Bindings ----
        self.root.bind("<Escape>", lambda e: self.exit_fullscreen())
        self.root.bind("f", self.toggle_fullscreen)
        self.root.bind("F", self.toggle_fullscreen)
        self.root.bind("<Up>", lambda e: self.change_volume(5))
        self.root.bind("<Down>", lambda e: self.change_volume(-5))
        self.root.bind("<space>", lambda e: self.toggle_play())
        self.root.bind("<Left>", lambda e: self.seek_relative(-10))
        self.root.bind("<Right>", lambda e: self.seek_relative(10))

        # ---- Embed VLC ----
        self.root.update()
        self.bind_vlc()

    # ---------------- VLC EMBEDDING ----------------
    def bind_vlc(self):
        handle = self.video_frame.winfo_id()
        system = platform.system()

        if system == "Windows":
            self.player.set_hwnd(handle)
        elif system == "Darwin":
            self.player.set_nsobject(handle)
        else:
            self.player.set_xwindow(handle)

    # ---------------- CONTROLS ----------------
    def open_file(self):
        path = filedialog.askopenfilename(
            filetypes=[("Video files", "*.mp4 *.mkv *.avi *.mov"), ("All files", "*.*")]
        )
        if not path:
            return

        media = self.instance.media_new(path)
        self.player.set_media(media)
        self.player.play()

        self.is_playing = True
        self.play_btn.configure(text="Pause")

    def toggle_play(self):
        if self.player.get_media() is None:
            return

        if self.is_playing:
            self.player.pause()
            self.play_btn.configure(text="Play")
        else:
            self.player.play()
            self.play_btn.configure(text="Pause")

        self.is_playing = not self.is_playing

    def seek_relative(self, seconds):
        current = self.player.get_time()
        if current >= 0:
            self.player.set_time(max(0, current + seconds * 1000))

    def jump_to_time(self):
        try:
            seconds = self.parse_time(self.jump_entry.get())
            self.player.set_time(seconds * 1000)
        except ValueError:
            messagebox.showerror("Invalid time", "Use seconds or mm:ss")

    def parse_time(self, t):
        t = t.strip()
        if ":" in t:
            m, s = t.split(":")
            return int(m) * 60 + int(s)
        return int(t)

    # ---------------- VOLUME ----------------
    def change_volume(self, delta):
        vol = self.player.audio_get_volume()
        if vol == -1:
            return

        new_vol = max(0, min(100, vol + delta))
        self.player.audio_set_volume(new_vol)

    # ---------------- FULLSCREEN ----------------
    def toggle_fullscreen(self, event=None):
        self.is_fullscreen = not self.is_fullscreen
        self.root.attributes("-fullscreen", self.is_fullscreen)

        if self.is_fullscreen:
            self.controls.pack_forget()
            self.fullscreen_btn.configure(text="Exit Fullscreen")
            self.root.config(cursor="none")
        else:
            self.controls.pack(pady=6)
            self.fullscreen_btn.configure(text="Fullscreen")
            self.root.config(cursor="")

    def exit_fullscreen(self):
        if self.is_fullscreen:
            self.toggle_fullscreen()

    def handle_mqtt_event(self, event):
        while not msg_queue.empty():
            msg = msg_queue.get()
            self.toggle_play()


def on_message(client, userdata, msg):
    msg_queue.put(msg.payload.decode())
    root.event_generate("<<MQTTMessage>>", when="tail")


def connect_with_retry():
    attempt = 0
    while attempt < 20:
        try:
            client.connect(BROKER, PORT)
            return
        except Exception as e:
            attempt += 1


if __name__ == "__main__":

    root = ctk.CTk()
    app = VideoPlayerGUI(root)
    root.bind("<<MQTTMessage>>", app.handle_mqtt_event)
    client = mqtt.Client(transport="websockets")
    client.tls_set()
    client.ws_set_options(path="/mqtt")
    client.on_message = on_message

    connect_with_retry()
    client.subscribe(TOPIC)
    client.loop_start()

    root.mainloop()

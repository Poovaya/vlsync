# video_player.py
import customtkinter as ctk
from tkinter import filedialog, messagebox
import vlc
import platform

class VideoPlayerGUI:
    def __init__(self, root, on_action=None):
        self.root = root
        self.on_action = on_action  # callback to publish actions

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
        # self.video_frame.bind("<Double-Button-1>", self.toggle_fullscreen)

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

        # ---- Embed VLC ----
        self.root.update()
        self._bind_vlc()

    # ---------------- VLC EMBEDDING ----------------
    def _bind_vlc(self):
        handle = self.video_frame.winfo_id()
        system = platform.system()

        if system == "Windows":
            self.player.set_hwnd(handle)
        elif system == "Darwin":
            self.player.set_nsobject(handle)
        else:
            self.player.set_xwindow(handle)

    # ---------------- ACTIONS ----------------
    def open_file(self):
        path = filedialog.askopenfilename(
            filetypes=[("Video files", "*.mp4 *.mkv *.avi *.mov")]
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
            action = "pause"
        else:
            self.player.play()
            self.play_btn.configure(text="Pause")
            action = "play"

        self.is_playing = not self.is_playing
        self._emit(action)

    # ---------------- MQTT INBOUND ----------------
    def handle_remote_action(self, action):
        if action == "play" and not self.is_playing:
            self.toggle_play()
        elif action == "pause" and self.is_playing:
            self.toggle_play()

    # ---------------- HELPERS ----------------
    def _emit(self, action, value=None):
        if self.on_action:
            payload = {"action": action}
            if value:
                payload["value"] = value
            self.on_action(payload)

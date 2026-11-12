package io.github.trolanin.ledaudio;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import java.util.concurrent.CopyOnWriteArrayList;

/** Minimal WebSocket server on 127.0.0.1 (this phone only), same protocol as led-audio.exe. */
final class WsServer {
    private final CopyOnWriteArrayList<Socket> open = new CopyOnWriteArrayList<>();
    private ServerSocket server;
    private volatile boolean running;

    void start(int port) throws Exception {
        server = new ServerSocket();
        server.setReuseAddress(true);
        server.bind(new java.net.InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 8);
        running = true;
        Thread t = new Thread(new Runnable() { @Override public void run() { acceptLoop(); } }, "ws-accept");
        t.setDaemon(true);
        t.start();
    }

    int clients() { return open.size(); }

    void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception ignored) { }
        for (Socket s : open) closeQuietly(s);
        open.clear();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = server.accept();
                Thread t = new Thread(new Runnable() { @Override public void run() { handle(s); } }, "ws-client");
                t.setDaemon(true);
                t.start();
            } catch (Exception e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket s) {
        try {
            s.setTcpNoDelay(true);
            InputStream in = s.getInputStream();
            StringBuilder req = new StringBuilder();
            int c;
            while ((c = in.read()) != -1) {
                req.append((char) c);
                if (req.length() > 8192) throw new Exception("request too large");
                int n = req.length();
                if (n >= 4 && req.charAt(n - 4) == '\r' && req.charAt(n - 3) == '\n' && req.charAt(n - 2) == '\r' && req.charAt(n - 1) == '\n') break;
            }
            String key = null;
            for (String line : req.toString().split("\r\n")) {
                if (line.toLowerCase(Locale.ROOT).startsWith("sec-websocket-key:")) key = line.substring(18).trim();
            }
            if (key == null) throw new Exception("not a WebSocket request");
            byte[] sha = MessageDigest.getInstance("SHA-1")
                    .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII));
            String resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: "
                    + Base64.getEncoder().encodeToString(sha) + "\r\n\r\n";
            OutputStream out = s.getOutputStream();
            synchronized (s) { out.write(resp.getBytes(StandardCharsets.US_ASCII)); out.flush(); }
            open.add(s);
            // Read (and ignore) client frames until it closes, so dead tabs are dropped.
            byte[] buf = new byte[512];
            int r;
            while ((r = in.read(buf)) != -1) {
                if (r > 0 && (buf[0] & 0x0F) == 8) break;   // close frame
            }
        } catch (Exception ignored) {
        }
        open.remove(s);
        closeQuietly(s);
    }

    void broadcast(byte[] payload) {
        byte[] f = new byte[2 + payload.length];
        f[0] = (byte) 0x82;               // FIN + binary
        f[1] = (byte) payload.length;     // < 126, unmasked (server → client)
        System.arraycopy(payload, 0, f, 2, payload.length);
        for (Socket s : open) {
            try {
                synchronized (s) { s.getOutputStream().write(f); }
            } catch (Exception e) {
                open.remove(s);
                closeQuietly(s);
            }
        }
    }

    private static void closeQuietly(Socket s) {
        try { s.close(); } catch (Exception ignored) { }
    }
}

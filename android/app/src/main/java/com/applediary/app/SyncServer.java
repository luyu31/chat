package com.applediary.app;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 局域网同步服务端：
 *  - TCP 端口随机，校验 4 位配对码后把备份包发给对方
 *  - UDP 8767 响应附近设备发现
 * 仅在本机热点 / 同一 WiFi 下工作，数据不经过任何服务器。
 */
public class SyncServer {

    private final File file;
    private final String code;
    private final String deviceName;

    private ServerSocket serverSocket;
    private DatagramSocket discoverySocket;
    private Thread acceptThread;
    private Thread discoveryThread;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private int port = 0;

    public SyncServer(File file, String code, String deviceName) {
        this.file = file;
        this.code = code;
        this.deviceName = deviceName == null ? "AppleDiary" : deviceName;
    }

    public int getPort() {
        return port;
    }

    public void start() throws IOException {
        if (running.get()) return;
        serverSocket = new ServerSocket(0);
        serverSocket.setReuseAddress(true);
        port = serverSocket.getLocalPort();
        running.set(true);

        acceptThread = new Thread(this::acceptLoop, "apple-sync-accept");
        acceptThread.start();

        discoveryThread = new Thread(this::discoveryLoop, "apple-sync-discovery");
        discoveryThread.start();
    }

    private void acceptLoop() {
        while (running.get()) {
            try {
                Socket socket = serverSocket.accept();
                handleClient(socket);
            } catch (IOException e) {
                if (!running.get()) break;
            } catch (Exception ignored) {
                // 单个连接异常不应终止服务
            }
        }
    }

    private void handleClient(Socket socket) {
        try {
            socket.setSoTimeout(30000);
            BufferedInputStream in = new BufferedInputStream(socket.getInputStream());
            OutputStream out = new BufferedOutputStream(socket.getOutputStream());

            String line = readLine(in, 128);
            if (line == null || !line.startsWith("APPLE1 ")) {
                writeError(out, "bad request");
                return;
            }
            String got = line.substring(7).trim();
            if (!code.equals(got)) {
                writeError(out, "code");
                return;
            }
            long length = file.length();
            out.write(("OK " + length + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();

            FileInputStream fis = new FileInputStream(file);
            byte[] buf = new byte[64 * 1024];
            int n;
            long sent = 0;
            while ((n = fis.read(buf)) > 0) {
                out.write(buf, 0, n);
                sent += n;
            }
            fis.close();
            out.flush();
        } catch (Exception ignored) {
            // 对方取消 / 网络中断
        } finally {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    private void writeError(OutputStream out, String msg) throws IOException {
        out.write(("ERR " + msg + "\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private void discoveryLoop() {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.setBroadcast(true);
            socket.bind(new InetSocketAddress(8767));
            socket.setSoTimeout(800);
            discoverySocket = socket;

            byte[] buf = new byte[256];
            while (running.get()) {
                try {
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    socket.receive(packet);
                    String msg = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).trim();
                    if (!"APPLE_DISCOVER".equals(msg)) continue;
                    String reply = "APPLE_SYNC " + safeName(deviceName) + " " + port + "\n";
                    byte[] data = reply.getBytes(StandardCharsets.UTF_8);
                    socket.send(new DatagramPacket(data, data.length, packet.getAddress(), packet.getPort()));
                } catch (java.net.SocketTimeoutException ignored) {
                    // 正常等待下一次广播
                } catch (IOException e) {
                    if (!running.get()) break;
                }
            }
        } catch (Exception ignored) {
            // 8767 被占用时只是无法自动发现，手动输入地址仍可同步
        } finally {
            if (socket != null) socket.close();
        }
    }

    public void stop() {
        running.set(false);
        try { if (serverSocket != null) serverSocket.close(); } catch (IOException ignored) {}
        try { if (discoverySocket != null) discoverySocket.close(); } catch (Exception ignored) {}
        joinQuietly(acceptThread);
        joinQuietly(discoveryThread);
        serverSocket = null;
        discoverySocket = null;
    }

    public boolean isRunning() {
        return running.get();
    }

    private static void joinQuietly(Thread t) {
        if (t == null) return;
        try { t.join(800); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    private static String safeName(String name) {
        return name.replace(' ', '_').replace('\n', '_');
    }

    static String readLine(BufferedInputStream in, int max) throws IOException {
        byte[] buf = new byte[max];
        int i = 0;
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (i < max - 1) buf[i++] = (byte) c;
        }
        if (i == 0 && c == -1) return null;
        String s = new String(buf, 0, i, StandardCharsets.UTF_8);
        return s.endsWith("\r") ? s.substring(0, s.length() - 1) : s;
    }

    public static String findLocalIpv4() {
        String fallback = "127.0.0.1";
        try {
            java.util.Enumeration<java.net.NetworkInterface> nifs = java.net.NetworkInterface.getNetworkInterfaces();
            while (nifs.hasMoreElements()) {
                java.net.NetworkInterface nif = nifs.nextElement();
                if (!nif.isUp() || nif.isLoopback()) continue;
                java.util.Enumeration<InetAddress> addrs = nif.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr instanceof java.net.Inet4Address && !addr.isLoopbackAddress()) {
                        String ip = addr.getHostAddress();
                        if (ip != null && (ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172."))) {
                            return ip;
                        }
                        fallback = ip;
                    }
                }
            }
        } catch (Exception ignored) {}
        return fallback;
    }
}

package com.applediary.app;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 局域网设备发现与备份拉取。 */
public class SyncClient {

    public static final int DISCOVERY_PORT = 8767;

    public static class Peer {
        public String name;
        public String host;
        public int port;
    }

    public interface Progress {
        void onProgress(long received, long total);
    }

    public static List<Peer> discover(int timeoutMs) {
        List<Peer> result = new ArrayList<>();
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(220);

            byte[] msg = "APPLE_DISCOVER".getBytes(StandardCharsets.UTF_8);
            List<InetAddress> targets = new ArrayList<>();
            targets.add(InetAddress.getByName("255.255.255.255"));
            try {
                Enumeration<NetworkInterface> nifs = NetworkInterface.getNetworkInterfaces();
                while (nifs.hasMoreElements()) {
                    NetworkInterface nif = nifs.nextElement();
                    if (!nif.isUp() || nif.isLoopback()) continue;
                    for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                        InetAddress b = ia.getBroadcast();
                        if (b != null && b instanceof Inet4Address) targets.add(b);
                    }
                }
            } catch (Exception ignored) {}

            for (InetAddress target : targets) {
                try {
                    socket.send(new DatagramPacket(msg, msg.length, target, DISCOVERY_PORT));
                } catch (Exception ignored) {}
            }

            long end = System.currentTimeMillis() + Math.max(800, timeoutMs);
            byte[] buf = new byte[512];
            Map<String, Peer> unique = new LinkedHashMap<>();
            while (System.currentTimeMillis() < end) {
                try {
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    socket.receive(packet);
                    String text = new String(packet.getData(), 0, packet.getLength(), StandardCharsets.UTF_8).trim();
                    String[] parts = text.split(" ");
                    if (parts.length < 3 || !"APPLE_SYNC".equals(parts[0])) continue;
                    Peer peer = new Peer();
                    peer.name = parts[1].replace('_', ' ');
                    peer.host = packet.getAddress().getHostAddress();
                    peer.port = Integer.parseInt(parts[2]);
                    unique.put(peer.host + ":" + peer.port, peer);
                } catch (java.net.SocketTimeoutException ignored) {
                    // 继续等
                } catch (Exception ignored) {}
            }
            result.addAll(unique.values());
        } catch (Exception ignored) {
        } finally {
            if (socket != null) socket.close();
        }
        return result;
    }

    public static void download(String host, int port, String code, File out, Progress progress) throws Exception {
        Socket socket = new Socket();
        socket.connect(new InetSocketAddress(host, port), 8000);
        socket.setSoTimeout(20000);
        try {
            OutputStream os = socket.getOutputStream();
            os.write(("APPLE1 " + code + "\n").getBytes(StandardCharsets.UTF_8));
            os.flush();

            BufferedInputStream in = new BufferedInputStream(socket.getInputStream());
            String line = SyncServer.readLine(in, 128);
            if (line == null) throw new Exception("对方没有响应");
            if (line.startsWith("ERR ")) {
                String reason = line.substring(4).trim();
                if ("code".equals(reason)) throw new Exception("配对码不正确");
                throw new Exception("对方拒绝了连接");
            }
            if (!line.startsWith("OK ")) throw new Exception("同步协议不匹配");
            long total = Long.parseLong(line.substring(3).trim());

            FileOutputStream fos = new FileOutputStream(out);
            BufferedOutputStream bos = new BufferedOutputStream(fos);
            byte[] buf = new byte[64 * 1024];
            long received = 0;
            while (received < total) {
                int want = (int) Math.min(buf.length, total - received);
                int n = in.read(buf, 0, want);
                if (n <= 0) break;
                bos.write(buf, 0, n);
                received += n;
                if (progress != null) progress.onProgress(received, total);
            }
            bos.flush();
            fos.flush();
            bos.close();
            fos.close();
            if (received != total) throw new Exception("传输不完整，请重试");
        } finally {
            try { socket.close(); } catch (Exception ignored) {}
        }
    }
}

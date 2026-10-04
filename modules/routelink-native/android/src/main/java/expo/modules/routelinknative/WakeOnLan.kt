package expo.modules.routelinknative

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

internal object WakeOnLan {
  /** Magic packet: 6 x 0xFF followed by the MAC repeated 16 times, sent as a UDP broadcast. */
  fun send(mac: String, broadcast: String?, port: Int?) {
    val hex = mac.replace(Regex("[^0-9A-Fa-f]"), "")
    if (hex.length != 12) throw NativeError("ERR_INVALID_ARGUMENT", "invalid MAC address: $mac")
    val macBytes = ByteArray(6) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    val packet = ByteArray(6 + 16 * 6)
    for (i in 0 until 6) packet[i] = 0xFF.toByte()
    for (r in 0 until 16) System.arraycopy(macBytes, 0, packet, 6 + r * 6, 6)
    try {
      DatagramSocket().use { socket ->
        socket.broadcast = true
        socket.send(DatagramPacket(packet, packet.size, InetAddress.getByName(broadcast ?: "255.255.255.255"), port ?: 9))
      }
    } catch (e: Exception) {
      throw NativeError("ERR_NETWORK", e.message ?: "failed to send magic packet", e)
    }
  }
}

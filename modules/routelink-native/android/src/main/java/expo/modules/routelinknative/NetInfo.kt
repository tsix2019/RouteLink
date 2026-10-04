package expo.modules.routelinknative

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Inet4Address

internal object NetInfo {
  fun read(context: Context): Map<String, Any?> {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = cm.activeNetwork
    val caps = network?.let { cm.getNetworkCapabilities(it) }
    val link = network?.let { cm.getLinkProperties(it) }
    val v4 = link?.linkAddresses?.firstOrNull { it.address is Inet4Address }
    val gateway = link?.routes?.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
    return mapOf(
      "isWifi" to (caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true),
      "ip" to v4?.address?.hostAddress,
      "netmask" to v4?.prefixLength?.let(::prefixToNetmask),
      "gateway" to gateway,
      "ifname" to link?.interfaceName,
    )
  }

  fun prefixToNetmask(prefix: Int): String {
    val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
    return listOf(24, 16, 8, 0).joinToString(".") { ((mask ushr it) and 0xff).toString() }
  }
}

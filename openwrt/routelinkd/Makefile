include $(TOPDIR)/rules.mk

PKG_NAME:=routelinkd
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=tsix2019 <tsix2019@users.noreply.github.com>

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/cmake.mk

define Package/routelinkd
  SECTION:=net
  CATEGORY:=Network
  TITLE:=RouteLink per-device traffic monitor
  URL:=https://github.com/tsix2019/RouteLink
  DEPENDS:=+libubox +libubus +libuci +libblobmsg-json +libjson-c +libmnl +kmod-nf-conntrack-netlink
endef

define Package/routelinkd/description
  Records upload and download traffic of every LAN device from conntrack
  accounting and serves it over ubus (object "routelink") for LuCI and the
  RouteLink app.
endef

define Package/routelinkd/conffiles
/etc/config/routelink
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

CMAKE_OPTIONS += -DRL_VERSION=$(PKG_VERSION)

define Package/routelinkd/install
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/init.d $(1)/etc/config $(1)/lib/upgrade/keep.d $(1)/etc/hotplug.d/ntp
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/routelinkd $(1)/usr/sbin/
	$(INSTALL_BIN) ./files/routelink.init $(1)/etc/init.d/routelink
	$(INSTALL_CONF) ./files/routelink.config $(1)/etc/config/routelink
	$(INSTALL_DATA) ./files/routelink.keep $(1)/lib/upgrade/keep.d/routelink
	$(INSTALL_DATA) ./files/routelink.upgrade.sh $(1)/lib/upgrade/routelink.sh
	$(INSTALL_DATA) ./files/routelink.ntp $(1)/etc/hotplug.d/ntp/90-routelink
endef

$(eval $(call BuildPackage,routelinkd))

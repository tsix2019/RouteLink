include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-routelink
PKG_VERSION:=0.1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT
PKG_MAINTAINER:=tsix2019 <tsix2019@users.noreply.github.com>

LUCI_TITLE:=LuCI support for RouteLink
LUCI_DEPENDS:=+routelinkd
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { useShallow } from 'zustand/react/shallow';
import { BarChart3, TrendingUp, Download, AlertTriangle } from 'lucide-react-native';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import Toast from 'react-native-toast-message';

import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius } from '../theme';

type ReportType = 'sales' | 'inventory' | 'profit';

const CHART_COLORS = ['#FF6B9D', '#5B8DEF', '#C77DFF', '#4ECDC4', '#FFB347'];

export default function ReportsScreen() {
  const { user, products, orders, fetchProducts, fetchOrders } = useAppStore(
    useShallow((state) => ({
      user: state.user,
      products: state.products,
      orders: state.orders,
      fetchProducts: state.fetchProducts,
      fetchOrders: state.fetchOrders,
    })),
  );
  const [reportType, setReportType] = useState<ReportType>('sales');

  const isDistributor = user?.role === 'distributor';

  useEffect(() => {
    fetchProducts();
    fetchOrders();
  }, []);

  const salesData = useMemo(() => {
    const totalRetailSales = orders.reduce((sum, o) => sum + Number(o.total_retail_amount || 0), 0);
    const totalOrders = orders.length;

    const productSalesQty: { [key: string]: { name: string; quantity: number } } = {};
    const productSalesAmt: { [key: string]: { name: string; amount: number } } = {};
    orders.forEach((order) => {
      order.items.forEach((it) => {
        const name = it.product_name || '未知';
        const key = it.product_id;
        // Quantity
        if (!productSalesQty[key]) {
          productSalesQty[key] = { name, quantity: 0 };
        }
        productSalesQty[key].quantity += it.quantity;
        // Amount
        if (!productSalesAmt[key]) {
          productSalesAmt[key] = { name, amount: 0 };
        }
        productSalesAmt[key].amount += Number(it.discount_price || 0) * it.quantity;
      });
    });

    const topProductsQty = Object.values(productSalesQty)
      .map((item) => ({ name: item.name, quantity: item.quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    const topProductsAmt = Object.values(productSalesAmt)
      .map((item) => ({ name: item.name, amount: item.amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Calculate velocity (turnover rate) = sales quantity / current inventory
    const productVelocity: { [key: string]: { name: string; velocity: number; quantity: number; inventory: number } } = {};
    products.forEach((p) => {
      const key = p.id;
      const qty = productSalesQty[key]?.quantity || 0;
      const inventory = p.quantity || 0;
      const velocity = inventory > 0 ? qty / inventory : 0;
      productVelocity[key] = {
        name: p.name,
        velocity,
        quantity: qty,
        inventory,
      };
    });

    const topProductsVelocity = Object.values(productVelocity)
      .map((item) => ({ 
        name: item.name, 
        velocity: item.velocity,
        quantity: item.quantity,
        inventory: item.inventory,
        isUnhealthy: item.velocity < 0.5, // Less than 0.5 means slow turnover
      }))
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 5);

    const citySales: { [key: string]: number } = {};
    orders.forEach((order) => {
      const city = order.city_name || '未知';
      citySales[city] = (citySales[city] || 0) + Number(order.total_discount_amount || 0);
    });

    const salesByCity = Object.entries(citySales)
      .map(([city, total]) => ({ city, total }))
      .sort((a, b) => b.total - a.total);

    return { totalRetailSales, totalOrders, topProductsQty, topProductsAmt, topProductsVelocity, salesByCity };
  }, [orders, products]);

  const inventoryData = useMemo(() => {
    const totalProducts = products.length;
    const lowStockItems = products.filter(
      (p) => p.quantity !== undefined && p.quantity < (p.min_quantity ?? 10),
    );

    const cityInventory: { [key: string]: number } = {};
    products.forEach((p) => {
      const city = p.city_name || '未知';
      cityInventory[city] = (cityInventory[city] || 0) + (p.quantity || 0);
    });

    const inventoryByCity = Object.entries(cityInventory)
      .map(([city, quantity]) => ({ city, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    return { totalProducts, lowStockItems, inventoryByCity };
  }, [products]);

  const profitData = useMemo(() => {
    const productProfit: {
      [key: string]: {
        name: string;
        quantity: number;
        retailPrice: number;
        retailRevenue: number;
        discountPrice: number;
        discountRevenue: number;
        unitCostTotal: number;
        oneTimeCost: number;
      };
    } = {};

    orders.forEach((order) => {
      order.items.forEach((it) => {
        const key = it.product_id;
        if (!productProfit[key]) {
          productProfit[key] = {
            name: it.product_name || '未知',
            quantity: 0,
            retailPrice: Number(it.retail_price || 0),
            retailRevenue: 0,
            discountPrice: Number(it.discount_price || 0),
            discountRevenue: 0,
            unitCostTotal: 0,
            oneTimeCost: Number(it.one_time_cost || 0),
          };
        }
        productProfit[key].quantity += it.quantity;
        productProfit[key].retailRevenue += it.quantity * Number(it.retail_price || 0);
        productProfit[key].discountRevenue += it.quantity * Number(it.discount_price || 0);
        productProfit[key].unitCostTotal += it.quantity * Number(it.unit_cost || 0);
        if (productProfit[key].oneTimeCost === 0) {
          productProfit[key].oneTimeCost = Number(it.one_time_cost || 0);
        }
      });
    });

    const profitByProduct = Object.values(productProfit)
      .map((v) => {
        const cost = v.unitCostTotal + v.oneTimeCost;
        return {
          name: v.name,
          quantity: v.quantity,
          retailPrice: v.retailPrice,
          retailRevenue: v.retailRevenue,
          discountPrice: v.discountPrice,
          discountRevenue: v.discountRevenue,
          cost,
          profit: v.discountRevenue - cost,
        };
      })
      .sort((a, b) => b.profit - a.profit);

    const totalRetailRevenue = profitByProduct.reduce((s, r) => s + r.retailRevenue, 0);
    const totalDiscountRevenue = profitByProduct.reduce((s, r) => s + r.discountRevenue, 0);
    const totalCost = profitByProduct.reduce((s, r) => s + r.cost, 0);

    return {
      totalRetailRevenue,
      totalDiscountRevenue,
      totalCost,
      totalProfit: totalDiscountRevenue - totalCost,
      profitByProduct,
    };
  }, [orders]);

  const exportProfitExcel = async () => {
    try {
      const headers = ['商品名称', '销量', '零售价', '零售总价', '折扣价', '折扣总收入', '总成本', '总利润'];
      const dataRows = profitData.profitByProduct.map((r) => [
        r.name,
        r.quantity,
        Number(r.retailPrice.toFixed(2)),
        Number(r.retailRevenue.toFixed(2)),
        Number(r.discountPrice.toFixed(2)),
        Number(r.discountRevenue.toFixed(2)),
        Number(r.cost.toFixed(2)),
        Number(r.profit.toFixed(2)),
      ]);
      const sheetData = [headers, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      // Auto-fit column widths based on content
      const colWidths = headers.map((h, colIdx) => {
        let maxLen = h.length * 2; // Chinese chars ~ 2 width
        dataRows.forEach((row) => {
          const cell = row[colIdx];
          const len = String(cell).length;
          if (len > maxLen) maxLen = len;
        });
        return { wch: Math.max(maxLen + 2, 10) };
      });
      ws['!cols'] = colWidths;

      // Center all cells
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          if (!ws[addr]) continue;
          if (!ws[addr].s) ws[addr].s = {};
          ws[addr].s = { alignment: { horizontal: 'center', vertical: 'center' } };
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '利润报表');
      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      const uri = `${FileSystem.cacheDirectory}profit-report-${Date.now()}.xlsx`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Excel 导出失败';
      Toast.show({ type: 'error', text1: '导出失败', text2: message });
    }
  };

  const exportProfitPdf = async () => {
    try {
      const rows = profitData.profitByProduct
        .map(
          (r) => `
          <tr>
            <td>${r.name}</td>
            <td>${r.retailRevenue.toFixed(2)}元</td>
            <td>${r.discountRevenue.toFixed(2)}元</td>
            <td>${r.cost.toFixed(2)}元</td>
            <td>${r.profit.toFixed(2)}元</td>
          </tr>`,
        )
        .join('');

      const html = `
        <html>
          <body style="font-family: Arial; padding: 20px;">
            <h2>利润报表</h2>
            <p>零售总价：${profitData.totalRetailRevenue.toFixed(2)}元</p>
            <p>折扣总收入：${profitData.totalDiscountRevenue.toFixed(2)}元</p>
            <p>总成本：${profitData.totalCost.toFixed(2)}元</p>
            <p>总利润：${profitData.totalProfit.toFixed(2)}元</p>
            <table border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width:100%;">
              <tr>
                <th>商品</th><th>零售总价</th><th>折扣总收入</th><th>总成本</th><th>总利润</th>
              </tr>
              ${rows}
            </table>
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'PDF 导出失败';
      Toast.show({ type: 'error', text1: '导出失败', text2: message });
    }
  };

  const renderTabButton = (key: ReportType, label: string) => {
    const isActive = reportType === key;
    return (
      <TouchableOpacity style={[styles.tab, isActive && styles.activeTabWrap]} onPress={() => setReportType(key)}>
        {isActive ? (
          <LinearGradient colors={['#FF6B9D', '#5B8DEF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.activeTab}>
            <Text style={styles.activeTabText}>{label}</Text>
          </LinearGradient>
        ) : (
          <Text style={styles.tabText}>{label}</Text>
        )}
      </TouchableOpacity>
    );
  };

  const renderSalesReport = () => (
    <ScrollView>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>销售概览</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{salesData.totalRetailSales.toFixed(2)}元</Text>
            <Text style={styles.statLabel}>零售总价</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{salesData.totalOrders}</Text>
            <Text style={styles.statLabel}>订单数量</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>商品销量排行榜</Text>
        {salesData.topProductsQty.length > 0 ? (
          <BarChart
            data={salesData.topProductsQty.map((item, index) => ({
              value: item.quantity,
              label: item.name.length > 4 ? item.name.slice(0, 4) + '..' : item.name,
              frontColor: CHART_COLORS[index % CHART_COLORS.length],
              topLabelComponent: () => (
                <Text style={{ fontSize: 10, color: Colors.textSecondary, marginBottom: 4 }}>
                  {item.quantity}
                </Text>
              ),
            }))}
            barWidth={30}
            spacing={20}
            roundedTop
            roundedBottom
            hideRules
            xAxisThickness={1}
            xAxisColor={Colors.divider}
            yAxisThickness={0}
            yAxisTextStyle={{ fontSize: 10, color: Colors.textTertiary }}
            noOfSections={4}
            maxValue={Math.ceil((salesData.topProductsQty[0]?.quantity || 1) * 1.2)}
            isAnimated
            animationDuration={500}
            height={150}
          />
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyText}>暂无销售数据</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>商品销售额排行榜</Text>
        {salesData.topProductsAmt.length > 0 ? (
          <BarChart
            data={salesData.topProductsAmt.map((item, index) => ({
              value: item.amount,
              label: item.name.length > 4 ? item.name.slice(0, 4) + '..' : item.name,
              frontColor: CHART_COLORS[index % CHART_COLORS.length],
              topLabelComponent: () => (
                <Text style={{ fontSize: 10, color: Colors.textSecondary, marginBottom: 4 }}>
                  {item.amount.toFixed(0)}
                </Text>
              ),
            }))}
            barWidth={30}
            spacing={20}
            roundedTop
            roundedBottom
            hideRules
            xAxisThickness={1}
            xAxisColor={Colors.divider}
            yAxisThickness={0}
            yAxisTextStyle={{ fontSize: 10, color: Colors.textTertiary }}
            noOfSections={4}
            maxValue={Math.ceil((salesData.topProductsAmt[0]?.amount || 1) * 1.2)}
            isAnimated
            animationDuration={500}
            height={150}
          />
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyText}>暂无销售数据</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>商品动销率排行榜</Text>
        <Text style={styles.cardSubtitle}>动销率 = 销售数量 / 当前库存，低于0.5标红</Text>
        {salesData.topProductsVelocity.length > 0 ? (
          salesData.topProductsVelocity.map((item, index) => (
            <View key={item.name} style={[styles.velocityItem, item.isUnhealthy && styles.velocityUnhealthyBg]}>
              <View style={styles.velocityRank}>
                <Text style={styles.velocityRankText}>{index + 1}</Text>
              </View>
              <View style={styles.velocityInfo}>
                <View style={styles.velocityNameRow}>
                  {item.isUnhealthy && <AlertTriangle size={14} color={Colors.danger} style={styles.alertIcon} />}
                  <Text style={[styles.velocityName, item.isUnhealthy && styles.velocityUnhealthy]}>
                    {item.name}
                  </Text>
                </View>
                <Text style={styles.velocityMeta}>
                  销量{item.quantity} / 库存{item.inventory} = 动销率{item.velocity.toFixed(2)}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <BarChart3 size={40} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyText}>暂无动销数据</Text>
          </View>
        )}
      </View>

      {salesData.salesByCity.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>城市销售分布</Text>
          <View style={styles.pieContainer}>
            <PieChart
              data={salesData.salesByCity.map((item, index) => ({
                value: item.total,
                color: CHART_COLORS[index % CHART_COLORS.length],
              }))}
              donut
              radius={70}
              innerRadius={40}
              innerCircleColor={Colors.surface}
              centerLabelComponent={() => (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>
                    {salesData.salesByCity.reduce((s, c) => s + c.total, 0).toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 10, color: Colors.textSecondary }}>总额</Text>
                </View>
              )}
            />
            <View style={styles.legendContainer}>
              {salesData.salesByCity.map((item, index) => (
                <View key={item.city} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
                  <Text style={styles.legendText}>{item.city}: {item.total.toFixed(0)}元</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );

  const renderInventoryReport = () => (
    <ScrollView>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>库存概览</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{inventoryData.totalProducts}</Text>
            <Text style={styles.statLabel}>商品种类</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{products.reduce((sum, p) => sum + (p.quantity || 0), 0)}</Text>
            <Text style={styles.statLabel}>总库存</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, inventoryData.lowStockItems.length > 0 && styles.warningText]}>
              {inventoryData.lowStockItems.length}
            </Text>
            <Text style={styles.statLabel}>库存不足</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );

  const renderProfitReport = () => (
    <ScrollView>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>利润概览</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{profitData.totalRetailRevenue.toFixed(2)}元</Text>
            <Text style={styles.statLabel}>零售总价</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{profitData.totalDiscountRevenue.toFixed(2)}元</Text>
            <Text style={styles.statLabel}>总收入(折扣)</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, styles.profitText]}>{profitData.totalProfit.toFixed(2)}元</Text>
            <Text style={styles.statLabel}>总利润</Text>
          </View>
        </View>
      </View>

      <View style={styles.exportRow}>
        <TouchableOpacity style={styles.exportButton} onPress={exportProfitExcel}>
          <Download size={14} color="#fff" />
          <Text style={styles.exportButtonText}>导出 Excel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.exportButton} onPress={exportProfitPdf}>
          <Download size={14} color="#fff" />
          <Text style={styles.exportButtonText}>导出 PDF</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>商品利润排行</Text>
        {profitData.profitByProduct.length > 0 ? (
          profitData.profitByProduct.map((item) => (
            <View key={item.name} style={styles.profitItem}>
              <View style={styles.profitItemHeader}>
                <Text style={styles.profitItemName}>{item.name}</Text>
                <Text style={[styles.profitItemValue, item.profit >= 0 ? styles.profitText : styles.lossText]}>
                  {item.profit.toFixed(2)}元
                </Text>
              </View>
              <View style={styles.profitDetails}>
                <Text style={styles.profitDetailText}>零售总价: {item.retailRevenue.toFixed(2)}元</Text>
                <Text style={styles.profitDetailText}>总收入: {item.discountRevenue.toFixed(2)}元</Text>
              </View>
              <View style={styles.profitDetails}>
                <Text style={styles.profitDetailText}>总成本: {item.cost.toFixed(2)}元</Text>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyChartContainer}>
            <TrendingUp size={40} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyText}>暂无利润数据</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>数据报表</Text>
      </View>

      <View style={styles.tabBar}>
        {renderTabButton('sales', '销售报表')}
        {!isDistributor && renderTabButton('inventory', '库存报表')}
        {!isDistributor && renderTabButton('profit', '利润报表')}
      </View>

      <View style={styles.content}>
        {reportType === 'sales' && renderSalesReport()}
        {!isDistributor && reportType === 'inventory' && renderInventoryReport()}
        {!isDistributor && reportType === 'profit' && renderProfitReport()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { padding: 15, backgroundColor: Colors.surface },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.textPrimary },
  tabBar: { flexDirection: 'row', backgroundColor: Colors.surface, paddingHorizontal: 10, paddingBottom: 10 },
  tab: {
    flex: 1,
    borderRadius: Radius.sm,
    marginHorizontal: 4,
    backgroundColor: Colors.surfaceSecondary,
    overflow: 'hidden',
  },
  activeTabWrap: { backgroundColor: 'transparent' },
  activeTab: { paddingVertical: 10, alignItems: 'center', borderRadius: Radius.sm },
  tabText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', paddingVertical: 10 },
  activeTabText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  content: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    margin: 10,
    marginBottom: 0,
    padding: 15,
    borderRadius: Radius.lg,
    ...Shadow.card,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 15, color: Colors.textPrimary },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  statLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },
  warningText: { color: Colors.danger },
  profitText: { color: Colors.success },
  lossText: { color: Colors.danger },
  pieContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  legendContainer: { marginLeft: 20 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  legendText: { fontSize: 12, color: Colors.textSecondary },
  emptyChartContainer: { alignItems: 'center', paddingVertical: 30 },
  emptyText: { textAlign: 'center', color: Colors.textTertiary, padding: 20, fontSize: 14 },
  exportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 10,
    marginTop: 10,
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row',
    marginHorizontal: 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  exportButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  profitItem: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  profitItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  profitItemName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  profitItemValue: { fontSize: 14, fontWeight: 'bold' },
  profitDetails: { flexDirection: 'row', justifyContent: 'space-between' },
  profitDetailText: { fontSize: 12, color: Colors.textSecondary },
  cardSubtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, marginBottom: 10 },
  velocityItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.divider },
  velocityRank: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.pink, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  velocityRankText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  velocityInfo: { flex: 1 },
  velocityNameRow: { flexDirection: 'row', alignItems: 'center' },
  velocityName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  velocityUnhealthy: { color: Colors.danger },
  velocityUnhealthyBg: { backgroundColor: 'rgba(248, 113, 113, 0.05)' },
  alertIcon: { marginRight: 6 },
  velocityMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
});

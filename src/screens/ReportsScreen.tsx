import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { useAppStore } from '../store/useAppStore';
import { Colors, Shadow, Radius } from '../theme';
import { BarChart3, TrendingUp, FileText, Download } from 'lucide-react-native';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import Toast from 'react-native-toast-message';

type ReportType = 'sales' | 'inventory' | 'profit';

const CHART_COLORS = ['#FF6B9D', '#5B8DEF', '#C77DFF', '#4ECDC4', '#FFB347'];

export default function ReportsScreen() {
  const { user, products, orders, fetchProducts, fetchOrders } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);
  const [reportType, setReportType] = useState<ReportType>('sales');

  const isDistributor = user?.role === 'distributor';

  useEffect(() => {
    fetchProducts();
    fetchOrders();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchProducts(), fetchOrders()]);
    setRefreshing(false);
  };

  const salesData = useMemo(() => {
    const totalRetailSales = orders.reduce((sum, o) => sum + Number(o.total_retail_amount || 0), 0);
    const totalOrders = orders.length;

    const productSales: { [key: string]: number } = {};
    orders.forEach((order) => {
      order.items.forEach((it) => {
        const name = it.product_name || '未知';
        productSales[name] = (productSales[name] || 0) + Number(it.discount_price || 0) * it.quantity;
      });
    });

    const topProducts = Object.entries(productSales)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const citySales: { [key: string]: number } = {};
    orders.forEach((order) => {
      const city = order.city_name || '未知';
      citySales[city] = (citySales[city] || 0) + Number(order.total_discount_amount || 0);
    });

    const salesByCity = Object.entries(citySales)
      .map(([city, total]) => ({ city, total }))
      .sort((a, b) => b.total - a.total);

    return { totalRetailSales, totalOrders, topProducts, salesByCity };
  }, [orders]);

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
    } catch (error: any) {
      Toast.show({ type: 'error', text1: '导出失败', text2: error?.message || 'Excel 导出失败' });
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
    } catch (error: any) {
      Toast.show({ type: 'error', text1: '导出失败', text2: error?.message || 'PDF 导出失败' });
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
        <Text style={styles.cardTitle}>商品销售排行</Text>
        {salesData.topProducts.length > 0 ? (
          <BarChart
            data={salesData.topProducts.map((item, index) => ({
              value: item.total,
              label: item.name.length > 4 ? item.name.slice(0, 4) + '..' : item.name,
              frontColor: CHART_COLORS[index % CHART_COLORS.length],
              topLabelComponent: () => (
                <Text style={{ fontSize: 10, color: Colors.textSecondary, marginBottom: 4 }}>
                  {item.total.toFixed(0)}
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
            maxValue={Math.ceil((salesData.topProducts[0]?.total || 1) * 1.2)}
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
});

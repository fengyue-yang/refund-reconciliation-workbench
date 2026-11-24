"use strict";

const inputs = {
  refunds: { name: "示例退款明细.csv", csv: "订单号,金额\nDEMO-1001,128.00\nDEMO-1002,45.50\nDEMO-1003,29.90\nDEMO-1004,76.00\nDEMO-1004,76.00" },
  flows: { name: "示例退款流水.csv", csv: "订单号,金额\nDEMO-1001,128.00\nDEMO-1002,40.50\nDEMO-1004,76.00\nDEMO-1005,18.00" },
};

function parseCsv(csv, source) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  const rows = [];
  for (const [index, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    const fields = raw.trim().match(/^(?:"([^"]*)"|([^,"]*))\s*,\s*(?:"([^"]*)"|([^,"]*))$/);
    if (!fields) throw new Error(source + "第 " + (index + 1) + " 行应为两列：订单号、金额。");
    const order = (fields[1] ?? fields[2]).trim();
    const amount = (fields[3] ?? fields[4]).trim();
    if (!rows.length && order === "订单号" && amount === "金额") {
      rows.push(null);
      continue;
    }
    if (!rows.length) throw new Error(source + "的表头应为「订单号,金额」。");
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(order) || !/^\d{1,9}(?:\.\d{1,2})?$/.test(amount)) {
      throw new Error(source + "第 " + (index + 1) + " 行的订单号或金额格式不正确。");
    }
    const [integer, decimal = ""] = amount.split(".");
    rows.push({ order, cents: Number(integer) * 100 + Number(decimal.padEnd(2, "0")) });
  }
  if (rows.length < 2) throw new Error(source + "没有可核对的明细。");
  return rows.slice(1);
}

function reconcile(refunds, flows) {
  const orders = new Map();
  for (const [side, values] of [["refunds", refunds], ["flows", flows]]) {
    for (const item of values) {
      if (!orders.has(item.order)) orders.set(item.order, { refunds: [], flows: [] });
      orders.get(item.order)[side].push(item.cents);
    }
  }
  const report = [];
  for (const [order, pair] of orders) {
    const { refunds: left, flows: right } = pair;
    let status;
    if (left.length > 1 || right.length > 1) status = "疑似重复，需人工复核";
    else if (!left.length) status = "缺少退款明细";
    else if (!right.length) status = "缺少退款流水";
    else status = left[0] === right[0] ? "一致" : "金额不一致";
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      report.push({ order, refund: left[i], flow: right[i], status });
    }
  }
  return report;
}

const amountText = (cents) => cents === undefined ? "" : (cents / 100).toFixed(2);

function download(name, csv) {
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initializeDemo() {
  const byId = (id) => document.getElementById(id);
  const selections = { refunds: null, flows: null };
  const status = byId("status");
  const run = byId("run");
  let report = [];

  function feedback(message, error = false) {
    status.textContent = message;
    status.toggleAttribute("data-error", error);
  }

  function updateInputs() {
    for (const key of Object.keys(selections)) {
      byId(key + "-label").textContent = selections[key]?.name || "未选择文件";
    }
    byId("results").hidden = true;
    report = [];
    run.disabled = !selections.refunds || !selections.flows;
    feedback(run.disabled ? "请选择两份 CSV，或载入演示数据。" : "文件已就绪，可以开始比对。");
  }

  for (const key of Object.keys(selections)) {
    byId(key).addEventListener("change", (event) => {
      selections[key] = event.target.files[0] || null;
      updateInputs();
    });
  }
  byId("use-sample").addEventListener("click", () => {
    for (const key of Object.keys(selections)) {
      byId(key).value = "";
      selections[key] = inputs[key];
    }
    updateInputs();
  });
  byId("download-inputs").addEventListener("click", () => {
    for (const input of Object.values(inputs)) download(input.name, input.csv);
  });

  function render(rows) {
    const metrics = byId("metrics");
    const matches = rows.filter((row) => row.status === "一致").length;
    metrics.replaceChildren();
    for (const [label, count] of [["比对明细", rows.length], ["一致", matches], ["待复核", rows.length - matches]]) {
      const item = document.createElement("span");
      const number = document.createElement("b");
      number.textContent = count;
      item.append(number, document.createTextNode(label));
      metrics.append(item);
    }
    const table = byId("rows");
    table.replaceChildren();
    for (const row of rows) {
      const tr = table.insertRow();
      [row.order, amountText(row.refund) || "—", amountText(row.flow) || "—", row.status].forEach((value, index) => {
        const td = tr.insertCell();
        if (index === 1 || index === 2) td.className = "money";
        td.textContent = value;
      });
    }
    byId("results").hidden = false;
  }

  byId("compare-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (run.disabled) return;
    const selected = { ...selections };
    const read = (input) => input.csv ?? input.text();
    try {
      const [refunds, flows] = await Promise.all([read(selected.refunds), read(selected.flows)]);
      if (selections.refunds !== selected.refunds || selections.flows !== selected.flows) return;
      report = reconcile(parseCsv(refunds, "退款管理明细"), parseCsv(flows, "平台退款流水"));
      render(report);
      feedback("比对完成。请在结果中查看待复核记录。");
    } catch (error) {
      if (selections.refunds !== selected.refunds || selections.flows !== selected.flows) return;
      report = [];
      byId("results").hidden = true;
      feedback(error.message, true);
    }
  });
  byId("download-results").addEventListener("click", () => {
    if (!report.length) return;
    const rows = report.map((row) => [row.order, amountText(row.refund), amountText(row.flow), row.status].join(","));
    download("退款比对演示结果.csv", ["订单号,退款金额,流水金额,核对结果", ...rows].join("\r\n"));
  });
  document.querySelectorAll("[data-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const overview = button.dataset.target === "overview";
      byId("overview").hidden = !overview;
      byId("compare").hidden = overview;
      byId("page-heading").textContent = overview ? "工作台概览" : "线上退款比对";
      document.querySelectorAll("nav button").forEach((nav) => {
        if (nav.dataset.target === button.dataset.target) nav.setAttribute("aria-current", "page");
        else nav.removeAttribute("aria-current");
      });
    });
  });
  updateInputs();
}

if (typeof document !== "undefined") initializeDemo();
